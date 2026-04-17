#!/usr/bin/env python3
"""
LLAW Meaningful Investment Checker — Analysis Pipeline

Loads extracted prospectus sections (tier1/ + tier2/ from extract_sections.py),
sends them to the Claude API with rulebook_prompt_v3.md as the system prompt,
and saves the structured JSON output as checker.json for the website viewer.

Usage:
    python analyze.py --extraction-dir ./extracted [options]

Environment:
    ANTHROPIC_API_KEY  Set in a .env file at the project root, or pass --api-key.
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import anthropic
from dotenv import load_dotenv

# Load .env from the project root (parent of pipeline/)
load_dotenv(Path(__file__).parent.parent / ".env")

# ---------------------------------------------------------------------------
# Label mappings: extract_sections.py module IDs → prompt tier/label
# ---------------------------------------------------------------------------

# Tier 2 labels are fixed in extract_sections.py's target_table.
# The only rename needed: corporate_structure_chart → corporate_structure.
TIER2_LABEL_MAP: dict[str, str] = {
    "sii_disclosure": "sii_disclosure",
    "pathfinder_sii": "pathfinder_sii",
    "pre_ipo_investment": "pre_ipo_investment",
    "cornerstone_placing": "cornerstone_placing",
    "history_of_group": "history_of_group",
    "corporate_structure_chart": "corporate_structure",  # rename
    "reorganisation": "reorganisation",
}

# Tier 1 module IDs are derived from ToC headings via derive_module_id(),
# so they vary by document. We match by substring.
TIER1_PATTERN_MAP: list[tuple[list[str], str]] = [
    # Patterns (all lowercase, underscores) → prompt label
    (["substantial_shareholders", "shareholding_structure", "share_structure"], "cap_table"),
    (["share_capital"], "cap_table"),
    (["directors_and_senior_management", "directors_supervisors", "directors_management",
      "directors_senior_management"], "directors_mgmt"),
    (["corporate_information", "listing_statistics", "summary_of_the_offering",
      "summary_of_terms", "offering_overview", "company_information",
      "expected_timetable"], "listing_statistics"),
]


def find_tier1_label(module_id: str) -> str:
    """Map a tier1 module_id to the prompt label it best corresponds to."""
    for patterns, label in TIER1_PATTERN_MAP:
        if any(p in module_id for p in patterns):
            return label
    return module_id


# ---------------------------------------------------------------------------
# Section loading
# ---------------------------------------------------------------------------

def load_json_file(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_sections(extraction_dir: Path) -> tuple[dict[str, dict], dict[str, dict]]:
    """
    Load tier1 and tier2 section JSON files from the extraction directory.

    Returns:
        tier1_sections: {prompt_label: section_data}
        tier2_sections: {prompt_label: section_data}
    """
    tier1_dir = extraction_dir / "tier1"
    tier2_dir = extraction_dir / "tier2"
    tier1: dict[str, dict] = {}
    tier2: dict[str, dict] = {}

    if tier2_dir.exists():
        for path in sorted(tier2_dir.glob("*.json")):
            module_id = path.stem
            data = load_json_file(path)
            label = TIER2_LABEL_MAP.get(module_id, module_id)
            tier2[label] = data
            logging.info("Loaded tier2/%s → tier2/%s (%d page blocks)",
                         module_id, label, len(data.get("page_blocks", [])))
    else:
        logging.warning("tier2/ directory not found in %s", extraction_dir)

    if tier1_dir.exists():
        for path in sorted(tier1_dir.glob("*.json")):
            module_id = path.stem
            data = load_json_file(path)
            label = find_tier1_label(module_id)
            # For labels that can match multiple files (cap_table, directors_mgmt),
            # keep only the first match so we don't send duplicate content.
            if label not in tier1:
                tier1[label] = data
                logging.info("Loaded tier1/%s → tier1/%s (%d page blocks)",
                             module_id, label, len(data.get("page_blocks", [])))
            else:
                logging.debug("Skipping duplicate tier1 label %s (already loaded)", label)
    else:
        logging.warning("tier1/ directory not found in %s", extraction_dir)

    return tier1, tier2


# ---------------------------------------------------------------------------
# User message construction
# ---------------------------------------------------------------------------

def _section_block(section_data: dict, prompt_label: str, tier: int) -> str:
    """
    Render a single section as a labelled JSON block for the user message.

    We include module_id, tier, start_page, end_page, and page_blocks so Claude
    can copy anchor phrases verbatim from page_blocks[].text (as required by
    the system prompt's source_anchor instructions).
    """
    clean = {
        "module_id": section_data.get("module_id", prompt_label),
        "tier": tier,
        "start_page": section_data.get("start_page"),
        "end_page": section_data.get("end_page"),
        "page_blocks": section_data.get("page_blocks", []),
    }
    header = f"=== FILE: tier{tier}/{prompt_label} ==="
    return f"{header}\n{json.dumps(clean, indent=2, ensure_ascii=False)}\n"


def build_user_message(tier1: dict[str, dict], tier2: dict[str, dict]) -> str:
    """Build the full user message combining all sections."""
    parts: list[str] = []

    # Tier 2 — in the order the system prompt describes them
    parts.append("=== TIER 2 SECTIONS (Primary SII Disclosure Content) ===")
    parts.append("These are the main working material for Modules A–H.\n")
    for label in ["sii_disclosure", "pathfinder_sii", "pre_ipo_investment",
                  "cornerstone_placing", "history_of_group", "corporate_structure",
                  "reorganisation"]:
        if label in tier2:
            parts.append(_section_block(tier2[label], label, 2))
    # Any extra tier2 sections not in the canonical order
    for label, data in tier2.items():
        if label not in {"sii_disclosure", "pathfinder_sii", "pre_ipo_investment",
                         "cornerstone_placing", "history_of_group", "corporate_structure",
                         "reorganisation"}:
            parts.append(_section_block(data, label, 2))

    # Tier 1 — cross-reference context
    parts.append("\n=== TIER 1 SECTIONS (Cross-Reference Context) ===")
    parts.append("Use only for [K] consistency checks; reference as tier1/<label>.\n")
    for label in ["cap_table", "directors_mgmt", "listing_statistics"]:
        if label in tier1:
            parts.append(_section_block(tier1[label], label, 1))
    # Any extra tier1 sections
    for label, data in tier1.items():
        if label not in {"cap_table", "directors_mgmt", "listing_statistics"}:
            parts.append(_section_block(data, label, 1))

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Claude API call
# ---------------------------------------------------------------------------

def call_claude(system_prompt: str, user_message: str,
                model: str, api_key: str) -> str:
    """Call the Claude API with prompt caching on the system prompt."""
    client = anthropic.Anthropic(api_key=api_key)

    logging.info("Calling Claude API  model=%s  system=%d chars  user=%d chars",
                 model, len(system_prompt), len(user_message))

    response = client.messages.create(
        model=model,
        max_tokens=16000,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                # Cache the (large) system prompt to reduce cost on re-runs
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_message}],
    )

    usage = response.usage
    logging.info(
        "API usage — input: %d tokens (cache_read: %d, cache_write: %d)  output: %d tokens",
        usage.input_tokens,
        getattr(usage, "cache_read_input_tokens", 0),
        getattr(usage, "cache_creation_input_tokens", 0),
        usage.output_tokens,
    )
    return response.content[0].text


# ---------------------------------------------------------------------------
# JSON validation
# ---------------------------------------------------------------------------

def validate_checker_json(data: dict) -> list[str]:
    """Return a list of structural warnings (not fatal errors)."""
    warnings: list[str] = []
    for field in ("meta", "modules", "summary"):
        if field not in data:
            warnings.append(f"Missing top-level field: {field}")
    if "meta" in data:
        for f in ("rulebook_version", "company_name", "analysis_date"):
            if f not in data["meta"]:
                warnings.append(f"Missing meta.{f}")
    if "modules" in data and not isinstance(data["modules"], list):
        warnings.append("modules must be a list")
    return warnings


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--extraction-dir", "-e",
        required=True,
        metavar="DIR",
        help="Directory containing tier1/ and tier2/ from extract_sections.py",
    )
    parser.add_argument(
        "--prompt", "-p",
        metavar="FILE",
        help="Path to rulebook_prompt_v3.md "
             "(default: ../public/rulebook_prompt_v3.md relative to this script)",
    )
    parser.add_argument(
        "--output", "-o",
        metavar="FILE",
        help="Output checker.json path "
             "(default: ../public/checker.json relative to this script)",
    )
    parser.add_argument(
        "--model", "-m",
        default="claude-opus-4-7",
        help="Claude model ID (default: claude-opus-4-7)",
    )
    parser.add_argument(
        "--api-key",
        help="Anthropic API key (default: ANTHROPIC_API_KEY env var)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable DEBUG logging",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s  %(levelname)-7s  %(message)s",
        stream=sys.stderr,
    )

    # Resolve paths relative to this script's location
    script_dir = Path(__file__).parent
    public_dir = script_dir.parent / "public"

    prompt_path = Path(args.prompt) if args.prompt else public_dir / "rulebook_prompt_v3.md"
    output_path = Path(args.output) if args.output else public_dir / "checker.json"

    # API key
    api_key = args.api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        logging.error(
            "No API key found. Set ANTHROPIC_API_KEY or pass --api-key."
        )
        return 1

    # Load system prompt
    if not prompt_path.exists():
        logging.error("Prompt file not found: %s", prompt_path)
        return 1
    system_prompt = prompt_path.read_text(encoding="utf-8")
    logging.info("Loaded system prompt  path=%s  chars=%d", prompt_path, len(system_prompt))

    # Load extracted sections
    extraction_dir = Path(args.extraction_dir)
    if not extraction_dir.exists():
        logging.error("Extraction directory not found: %s", extraction_dir)
        return 1

    tier1, tier2 = load_sections(extraction_dir)

    if not tier2:
        logging.warning(
            "No tier2 sections found — Modules A–H will have limited evidence. "
            "Check that extract_sections.py completed successfully."
        )
    logging.info(
        "Sections ready — tier2: %s  tier1: %s",
        list(tier2.keys()), list(tier1.keys()),
    )

    # Build user message
    user_message = build_user_message(tier1, tier2)
    logging.info("User message length: %d chars", len(user_message))

    # Call API
    try:
        response_text = call_claude(system_prompt, user_message, args.model, api_key)
    except anthropic.APIError as exc:
        logging.error("Claude API error: %s", exc)
        return 1

    # Parse JSON (strip any accidental markdown fences)
    text = response_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # Drop first line (```json or ```) and last line (```)
        end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[1:end])

    try:
        checker_data = json.loads(text)
    except json.JSONDecodeError as exc:
        logging.error("Failed to parse API response as JSON: %s", exc)
        raw_path = output_path.with_suffix(".raw.txt")
        raw_path.write_text(response_text, encoding="utf-8")
        logging.error("Raw response saved to %s for debugging", raw_path)
        return 1

    # Validate structure
    warnings = validate_checker_json(checker_data)
    for w in warnings:
        logging.warning("Schema warning: %s", w)

    # Save
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(checker_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    logging.info("Saved checker.json → %s", output_path)

    # Summary
    meta = checker_data.get("meta", {})
    summ = checker_data.get("summary", {})
    print(
        f"\n{'='*60}\n"
        f"Analysis complete: {meta.get('company_name', 'unknown company')}\n"
        f"{'='*60}\n"
        f"  Rules checked : {summ.get('total_rules_checked', '?')}\n"
        f"  Present       : {summ.get('present', '?')}\n"
        f"  Absent        : {summ.get('absent', '?')}\n"
        f"  Insufficient  : {summ.get('insufficient', '?')}\n"
        f"  Reasoning flags: {summ.get('reasoning_flags_total', '?')} "
        f"(Critical: {summ.get('critical_flags', '?')}, "
        f"High: {summ.get('high_flags', '?')}, "
        f"Medium: {summ.get('medium_flags', '?')})\n"
        f"  Output        : {output_path}\n"
        f"{'='*60}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
