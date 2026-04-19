#!/usr/bin/env python3
"""
LLAW Meaningful Investment Checker — Analysis Script

Loads extracted prospectus sections (tier1/ + tier2/ from extract_sections.py),
sends all sections in a single Gemini API call, and writes checker.json.

Usage:
    python backend/analyze.py --extraction-dir ./extracted [options]

Environment:
    GEMINI_API_KEY  Set in .env at the project root, or pass --api-key.
"""

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

# .env lives at the project root (parent of backend/)
load_dotenv(Path(__file__).parent.parent / ".env")

_BACKEND_DIR   = Path(__file__).parent
_PROJECT_DIR   = _BACKEND_DIR.parent
_REFERENCE_DIR = _PROJECT_DIR / "reference"
_PUBLIC_DIR    = _PROJECT_DIR / "public"

# Label normalisation maps
TIER2_LABEL_MAP = {
    "sii_disclosure":          "sii_disclosure",
    "pathfinder_sii":          "pathfinder_sii",
    "pre_ipo_investment":      "pre_ipo_investment",
    "cornerstone_placing":     "cornerstone_placing",
    "history_of_group":        "history_of_group",
    "corporate_structure_chart": "corporate_structure",
    "reorganisation":          "reorganisation",
}

TIER1_PATTERN_MAP = [
    (["share_capital", "shareholding_structure", "substantial_shareholders"], "cap_table"),
    (["directors_and_senior_management", "directors_supervisors", "directors_management"], "directors_mgmt"),
    (["listing_statistics", "corporate_information", "summary",
      "listing_statistic", "corporate_info"],                                 "listing_statistics"),
    (["history_corporate_structure", "history_and_corporate",
      "history_development"],                                                 "history_corporate"),
    (["relationship_controlling", "controlling_shareholder"],                 "controlling_shareholder"),
    (["cornerstone_investors", "cornerstone_investor"],                       "cornerstone_investors"),
]

# How many page_blocks per section to include in the API call.
# Increase this if important information appears late in a section.
PAGE_BLOCKS_PER_SECTION = 60


def find_tier1_label(file_stem: str) -> str:
    for patterns, label in TIER1_PATTERN_MAP:
        if any(p in file_stem for p in patterns):
            return label
    return file_stem


# ---------------------------------------------------------------------------
# Section loading
# ---------------------------------------------------------------------------

def load_json_file(path: Path) -> dict:
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
        logging.warning("Non-UTF-8 bytes in %s; replaced with \\ufffd", path.name)
    return json.loads(text)


def load_sections(extraction_dir: Path) -> tuple[dict, dict]:
    """Returns (tier1, tier2) dicts mapping label → section data."""
    tier1: dict = {}
    tier2: dict = {}

    tier2_dir = extraction_dir / "tier2"
    tier1_dir = extraction_dir / "tier1"

    if tier2_dir.exists():
        for path in sorted(tier2_dir.glob("*.json")):
            label = TIER2_LABEL_MAP.get(path.stem, path.stem)
            tier2[label] = load_json_file(path)
            logging.info("Loaded tier2/%s → %s", path.stem, label)
    else:
        logging.warning("No tier2 directory at %s", tier2_dir)

    if tier1_dir.exists():
        for path in sorted(tier1_dir.glob("*.json")):
            label = find_tier1_label(path.stem)
            if label not in tier1:
                tier1[label] = load_json_file(path)
                logging.info("Loaded tier1/%s → %s", path.stem, label)
            else:
                logging.debug("tier1 label '%s' already loaded; skipping %s", label, path.stem)
    else:
        logging.warning("No tier1 directory at %s", tier1_dir)

    return tier1, tier2


# ---------------------------------------------------------------------------
# Message building — single call with all sections
# ---------------------------------------------------------------------------

def _section_block(data: dict, label: str, tier: int) -> str:
    safe = dict(data)
    blocks = data.get("page_blocks", [])
    if len(blocks) > PAGE_BLOCKS_PER_SECTION:
        logging.debug("Truncating %s/%s: %d → %d page_blocks",
                      f"tier{tier}", label, len(blocks), PAGE_BLOCKS_PER_SECTION)
        safe["page_blocks"] = blocks[:PAGE_BLOCKS_PER_SECTION]
    return f"=== FILE: tier{tier}/{label} ===\n{json.dumps(safe, ensure_ascii=False)}\n"


def build_full_message(tier1: dict, tier2: dict) -> str:
    """Build a single user message containing all available tier1 and tier2 sections."""
    parts = [
        "Analyse the following extracted prospectus sections according to the rulebook "
        "in your system prompt. Evaluate ALL modules (0, A, B, C, D, E, F, G, H, I) "
        "and ALL rules within each module. Every rule must appear in the output with a "
        "status of Present, Absent, Insufficient, or Not Applicable — do not omit any. "
        "Return the complete checker.json output exactly matching the schema in Section 5 "
        "of the system prompt.\n",
    ]

    # Tier 2 first (primary SII disclosure content)
    if tier2:
        parts.append("\n--- TIER 2: Primary SII Disclosure Sections ---\n")
        for label, data in sorted(tier2.items()):
            parts.append(_section_block(data, label, 2))
    else:
        parts.append("\n[WARNING: No tier2 sections found — all tier2-dependent rules may be Absent]\n")

    # Tier 1 (cross-reference context)
    if tier1:
        parts.append("\n--- TIER 1: Cross-Reference Context Sections ---\n")
        for label, data in sorted(tier1.items()):
            parts.append(_section_block(data, label, 1))
    else:
        parts.append("\n[WARNING: No tier1 sections found — all K-checks will be unable to cross-reference]\n")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Gemini API call with retry
# ---------------------------------------------------------------------------

def call_gemini(system_prompt: str, user_message: str, model: str, api_key: str,
                max_tokens: int = 32768, max_retries: int = 5) -> str:
    client = genai.Client(api_key=api_key)

    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=model,
                contents=user_message,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    max_output_tokens=max_tokens,
                    temperature=0.0,
                    response_mime_type="application/json",
                ),
            )
            return response.text
        except Exception as exc:
            exc_type = type(exc).__name__
            if "ResourceExhausted" in exc_type or "429" in str(exc):
                wait = 65 * (attempt + 1)
                logging.warning("Rate limit (%s) — waiting %ds (attempt %d/%d)",
                                exc_type, wait, attempt + 1, max_retries)
                time.sleep(wait)
            elif "ServiceUnavailable" in exc_type or "503" in str(exc):
                wait = 30 * (attempt + 1)
                logging.warning("Service unavailable — waiting %ds (attempt %d/%d)",
                                wait, attempt + 1, max_retries)
                time.sleep(wait)
            else:
                raise

    raise RuntimeError(f"Exhausted {max_retries} retries")


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------

def clean_json(text: str) -> dict:
    text = text.strip()
    # Strip markdown fences if present despite response_mime_type
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return json.loads(text)


def _count_by_severity(items: list[dict], severity: str) -> int:
    return sum(1 for x in items if x.get("severity") == severity)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--extraction-dir", required=True,
                        help="Directory with tier1/ and tier2/ from extract_sections.py")
    parser.add_argument("--prompt",
                        default=str(_REFERENCE_DIR / "rulebook_prompt_v3.md"),
                        help="Path to rulebook_prompt_v3.md (default: reference/)")
    parser.add_argument("--rulebook",
                        default=str(_PUBLIC_DIR / "rulebook.pdf"),
                        help="(Unused with Gemini — kept for CLI compatibility)")
    parser.add_argument("--output",
                        default=str(_PUBLIC_DIR / "checker.json"),
                        help="Output checker.json path (default: public/checker.json)")
    parser.add_argument("--model", default="gemini-2.5-pro")
    parser.add_argument("--api-key")
    parser.add_argument("--max-tokens", type=int, default=32768,
                        help="Max output tokens (default: 32768)")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s  %(levelname)-7s  %(message)s",
    )

    api_key = args.api_key or os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        logging.error("No API key found. Set GEMINI_API_KEY in .env or pass --api-key.")
        sys.exit(1)

    # Load system prompt
    prompt_path = Path(args.prompt)
    if not prompt_path.exists():
        logging.error("Prompt not found: %s", prompt_path)
        sys.exit(1)
    system_prompt = prompt_path.read_text(encoding="utf-8")
    logging.info("Prompt loaded: %s (%d chars)", prompt_path, len(system_prompt))

    # Load extracted sections
    tier1, tier2 = load_sections(Path(args.extraction_dir))
    logging.info("Sections — tier2: %s", list(tier2))
    logging.info("Sections — tier1: %s", list(tier1))

    if not tier2 and not tier1:
        logging.error("No sections found in %s — aborting.", args.extraction_dir)
        sys.exit(1)

    # Build single message with all sections
    user_message = build_full_message(tier1, tier2)
    logging.info("User message: %d chars across %d tier2 + %d tier1 sections",
                 len(user_message), len(tier2), len(tier1))

    # Single API call
    logging.info("Calling Gemini (%s) — this may take a few minutes…", args.model)
    raw = call_gemini(system_prompt, user_message, args.model, api_key, args.max_tokens)
    logging.info("Response received: %d chars", len(raw))

    # Parse and validate
    try:
        final = clean_json(raw)
    except json.JSONDecodeError as exc:
        logging.error("Failed to parse Gemini response as JSON: %s", exc)
        logging.error("Raw response (first 2000 chars): %s", raw[:2000])
        sys.exit(1)

    # Patch in summary counts computed from modules if model omitted them
    modules = final.get("modules", [])
    if modules and not final.get("summary", {}).get("total_rules_checked"):
        all_rules = [r for m in modules for r in m.get("rules", [])]
        counts = {"present": 0, "absent": 0, "insufficient": 0, "not_applicable": 0}
        for r in all_rules:
            s = r.get("status", "").lower().replace(" ", "_")
            if s in counts:
                counts[s] += 1
        flags = final.get("reasoning_flags", [])
        final.setdefault("summary", {}).update({
            **counts,
            "total_rules_checked": sum(counts.values()),
            "reasoning_flags_total": len(flags),
            "critical_flags": _count_by_severity(flags, "Critical"),
            "high_flags":     _count_by_severity(flags, "High"),
            "medium_flags":   _count_by_severity(flags, "Medium"),
        })

    # Write output
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(final, indent=2, ensure_ascii=False), encoding="utf-8")
    logging.info("Saved → %s", output_path)

    s = final.get("summary", {})
    print(
        f"\n{'='*60}\n"
        f"Analysis complete: {final.get('meta', {}).get('company_name', '?')}\n"
        f"{'='*60}\n"
        f"  Modules: {len(modules)}\n"
        f"  Present: {s.get('present', '?')}  Absent: {s.get('absent', '?')}  "
        f"Insufficient: {s.get('insufficient', '?')}  N/A: {s.get('not_applicable', '?')}\n"
        f"  Reasoning flags: {s.get('reasoning_flags_total', '?')} "
        f"(Crit: {s.get('critical_flags', '?')} "
        f"High: {s.get('high_flags', '?')} "
        f"Med: {s.get('medium_flags', '?')})\n"
        f"  Output: {output_path}\n"
        f"{'='*60}"
    )


if __name__ == "__main__":
    main()
