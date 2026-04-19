#!/usr/bin/env python3
"""
LLAW Meaningful Investment Checker — Analysis Script

Loads extracted prospectus sections (tier1/ + tier2/ from extract_sections.py),
sends each module to the Claude API, and assembles checker.json.

Usage:
    python backend/analyze.py --extraction-dir ./extracted [options]

Environment:
    ANTHROPIC_API_KEY  Set in .env at the project root, or pass --api-key.
"""

import argparse
import base64
import json
import logging
import os
import sys
import time
from pathlib import Path

import anthropic
from dotenv import load_dotenv

# .env lives at the project root (parent of backend/)
load_dotenv(Path(__file__).parent.parent / ".env")

# ---------------------------------------------------------------------------
# Paths (all relative to this file so the script works from any cwd)
# ---------------------------------------------------------------------------
_BACKEND_DIR  = Path(__file__).parent
_PROJECT_DIR  = _BACKEND_DIR.parent
_REFERENCE_DIR = _PROJECT_DIR / "reference"
_PUBLIC_DIR   = _PROJECT_DIR / "public"

# ---------------------------------------------------------------------------
# Module config — which tier1/tier2 sections each module needs
# ---------------------------------------------------------------------------
MODULE_CONFIG = {
    "MODULE_0": {
        "tier2": ["sii_disclosure"],
        "tier1": ["listing_statistics"],
        "max_tokens": 2500,
        "extra_instruction": (
            "Also return 'company_classification' and 'meta' (with company_name and "
            "analysis_date as ISO 8601 string) at the top level of your JSON response."
        ),
    },
    "MODULE_A": {
        "tier2": ["sii_disclosure", "corporate_structure"],
        "tier1": ["directors_mgmt"],
        "max_tokens": 4000,
    },
    "MODULE_B": {
        "tier2": ["sii_disclosure"],
        "tier1": [],
        "max_tokens": 4500,
    },
    "MODULE_C": {
        "tier2": ["sii_disclosure", "pre_ipo_investment"],
        "tier1": ["cap_table"],
        "max_tokens": 3000,
    },
    "MODULE_D": {
        "tier2": ["pathfinder_sii"],
        "tier1": ["cap_table"],
        "max_tokens": 3000,
    },
    "MODULE_E": {
        "tier2": ["sii_disclosure"],
        "tier1": ["cap_table", "listing_statistics"],
        "max_tokens": 2000,
    },
    "MODULE_F": {
        "tier2": ["sii_disclosure", "pre_ipo_investment"],
        "tier1": ["cap_table"],
        "max_tokens": 2000,
        "extra_instruction": (
            "Evaluate whether Module F is triggered. "
            "Include a 'trigger_basis' field (one sentence) inside the module object."
        ),
    },
    "MODULE_G": {
        "tier2": ["pathfinder_sii"],
        "tier1": [],
        "max_tokens": 1200,
        "extra_instruction": (
            "Evaluate whether Module G is triggered. "
            "Include a 'trigger_basis' field (one sentence) inside the module object."
        ),
    },
    "MODULE_H": {
        "tier2": ["cornerstone_placing", "sii_disclosure"],
        "tier1": [],
        "max_tokens": 3500,
        "extra_instruction": (
            "Evaluate whether Module H is triggered. "
            "Include a 'trigger_basis' field (one sentence) inside the module object."
        ),
    },
    "MODULE_I": {
        "tier2": ["corporate_structure", "history_of_group"],
        "tier1": [],
        "max_tokens": 1200,
        "extra_instruction": (
            "Evaluate whether Module I is triggered. "
            "Include a 'trigger_basis' field (one sentence) inside the module object."
        ),
    },
}

# ---------------------------------------------------------------------------
# Label maps (extract_sections.py IDs → prompt-expected names)
# ---------------------------------------------------------------------------
TIER2_LABEL_MAP = {
    "sii_disclosure": "sii_disclosure",
    "pathfinder_sii": "pathfinder_sii",
    "pre_ipo_investment": "pre_ipo_investment",
    "cornerstone_placing": "cornerstone_placing",
    "history_of_group": "history_of_group",
    "corporate_structure_chart": "corporate_structure",
    "reorganisation": "reorganisation",
}

TIER1_PATTERN_MAP = [
    (["share_capital", "shareholding_structure", "substantial_shareholders"], "cap_table"),
    (["directors_and_senior_management", "directors_supervisors", "directors_management"], "directors_mgmt"),
    (["listing_statistics", "corporate_information", "summary"], "listing_statistics"),
]


def find_tier1_label(module_id: str) -> str:
    for patterns, label in TIER1_PATTERN_MAP:
        if any(p in module_id for p in patterns):
            return label
    return module_id


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
    tier1: dict = {}
    tier2: dict = {}

    tier2_dir = extraction_dir / "tier2"
    tier1_dir = extraction_dir / "tier1"

    if tier2_dir.exists():
        for path in sorted(tier2_dir.glob("*.json")):
            label = TIER2_LABEL_MAP.get(path.stem, path.stem)
            tier2[label] = load_json_file(path)
            logging.info("Loaded tier2/%s → %s", path.stem, label)

    if tier1_dir.exists():
        for path in sorted(tier1_dir.glob("*.json")):
            label = find_tier1_label(path.stem)
            if label not in tier1:
                tier1[label] = load_json_file(path)
                logging.info("Loaded tier1/%s → %s", path.stem, label)

    return tier1, tier2


# ---------------------------------------------------------------------------
# Message building
# ---------------------------------------------------------------------------

def _section_block(data: dict, label: str, tier: int) -> str:
    safe = dict(data)
    safe["page_blocks"] = data.get("page_blocks", [])[:20]  # cap to avoid huge messages
    return f"=== FILE: tier{tier}/{label} ===\n{json.dumps(safe, ensure_ascii=False)}\n"


def build_module_message(module_name: str, tier1: dict, tier2: dict) -> str:
    config = MODULE_CONFIG[module_name]
    parts = [
        f"Only analyse {module_name}. Ignore all other modules. Return ONLY valid JSON.\n",
    ]
    if extra := config.get("extra_instruction", ""):
        parts.append(extra + "\n")

    for label in config["tier2"]:
        if label in tier2:
            parts.append(_section_block(tier2[label], label, 2))
    for label in config["tier1"]:
        if label in tier1:
            parts.append(_section_block(tier1[label], label, 1))

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Claude API call with caching + retry
# ---------------------------------------------------------------------------

def call_claude(system_prompt: str, module_name: str, user_message: str,
                model: str, api_key: str, rulebook_b64: str | None = None,
                max_tokens: int = 4000, max_retries: int = 5) -> str:
    client = anthropic.Anthropic(api_key=api_key)

    system_blocks = [
        {
            "type": "text",
            "text": system_prompt + f"\n\nIMPORTANT: Only evaluate {module_name}.",
            "cache_control": {"type": "ephemeral"},
        }
    ]

    user_content: list[dict] = []
    if rulebook_b64:
        user_content.append({
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": rulebook_b64},
            "title": "HKEX Guide for New Listing Applicants — Meaningful Investment Rulebook",
            "cache_control": {"type": "ephemeral"},
        })
    user_content.append({"type": "text", "text": user_message})

    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system_blocks,
                messages=[{"role": "user", "content": user_content}],
            )
            return response.content[0].text
        except anthropic.RateLimitError:
            wait = 65 * (attempt + 1)
            logging.warning("%s: rate limit — waiting %ds (attempt %d/%d)",
                            module_name, wait, attempt + 1, max_retries)
            time.sleep(wait)
        except anthropic.APIStatusError as exc:
            if exc.status_code == 529:
                wait = 30 * (attempt + 1)
                logging.warning("%s: API overloaded — waiting %ds (attempt %d/%d)",
                                module_name, wait, attempt + 1, max_retries)
                time.sleep(wait)
            else:
                raise

    raise RuntimeError(f"{module_name}: exhausted {max_retries} retries")


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------

def clean_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1])
    return json.loads(text)


def _count_by_severity(items: list[dict], severity: str) -> int:
    return sum(1 for x in items if x.get("severity") == severity)


def build_overall_assessment(counts: dict, flags: list[dict]) -> str:
    p, a, i = counts["present"], counts["absent"], counts["insufficient"]
    na, total = counts["not_applicable"], p + a + i
    parts = [
        f"{p} of {total} checked rules are Present ({na} Not Applicable); "
        f"{a} Absent and {i} Insufficient findings require attention."
    ]
    crit = _count_by_severity(flags, "Critical")
    high = _count_by_severity(flags, "High")
    if crit:
        summaries = "; ".join(f["summary"] for f in flags if f.get("severity") == "Critical")
        parts.append(f"Critical flags: {summaries}.")
    elif high:
        summaries = "; ".join(f["summary"] for f in flags if f.get("severity") == "High")
        parts.append(f"High-priority flags: {summaries}.")
    if flags:
        parts.append(f"{len(flags)} reasoning flag(s) require priority legal review.")
    return " ".join(parts)


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
                        help="Path to rulebook PDF sent with each API call (default: public/rulebook.pdf)")
    parser.add_argument("--output",
                        default=str(_PUBLIC_DIR / "checker.json"),
                        help="Output checker.json path (default: public/checker.json)")
    parser.add_argument("--model", default="claude-opus-4-7")
    parser.add_argument("--api-key")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s  %(levelname)-7s  %(message)s",
    )

    api_key = args.api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        logging.error("No API key found. Set ANTHROPIC_API_KEY in .env or pass --api-key.")
        sys.exit(1)

    # Load system prompt
    prompt_path = Path(args.prompt)
    if not prompt_path.exists():
        logging.error("Prompt not found: %s", prompt_path)
        sys.exit(1)
    system_prompt = prompt_path.read_text(encoding="utf-8")
    logging.info("Prompt loaded: %s (%d chars)", prompt_path, len(system_prompt))

    # Load rulebook PDF as base64 (cached in API calls)
    rulebook_b64: str | None = None
    rulebook_path = Path(args.rulebook)
    if rulebook_path.exists():
        rulebook_b64 = base64.standard_b64encode(rulebook_path.read_bytes()).decode("utf-8")
        logging.info("Rulebook PDF: %s (%d KB base64)", rulebook_path, len(rulebook_b64) // 1024)
    else:
        logging.warning("Rulebook PDF not found at %s — proceeding without it.", rulebook_path)

    # Load extracted sections
    tier1, tier2 = load_sections(Path(args.extraction_dir))
    logging.info("Sections — tier2: %s  tier1: %s", list(tier2), list(tier1))

    # Run each module
    all_modules: list[dict] = []
    reasoning_flags: list[dict] = []
    summary_counts = {"present": 0, "absent": 0, "insufficient": 0, "not_applicable": 0}
    company_classification: dict | None = None
    meta_extra: dict = {}
    trigger_data: dict[str, dict | None] = {k: None for k in "FGHI"}

    INTER_MODULE_SLEEP = 20  # seconds between calls (output token budget)

    for idx, module in enumerate(MODULE_CONFIG):
        if idx > 0:
            logging.info("Sleeping %ds before %s (rate limit budget)", INTER_MODULE_SLEEP, module)
            time.sleep(INTER_MODULE_SLEEP)

        logging.info("Running %s", module)
        msg = build_module_message(module, tier1, tier2)
        logging.info("%s message: %d chars", module, len(msg))

        try:
            raw = call_claude(
                system_prompt, module, msg, args.model, api_key,
                rulebook_b64, MODULE_CONFIG[module].get("max_tokens", 4000),
            )
            data = clean_json(raw)

            if module == "MODULE_0":
                company_classification = data.get("company_classification")
                if "meta" in data:
                    for k in ("company_name", "analysis_date"):
                        if k in data["meta"]:
                            meta_extra[k] = data["meta"][k]

            for mod in data.get("modules", []):
                all_modules.append(mod)
                mid = mod.get("module_id", "")
                if mid in trigger_data:
                    trigger_data[mid] = {
                        "triggered": mod.get("triggered", False),
                        "trigger_basis": mod.get("trigger_basis", ""),
                    }

            reasoning_flags.extend(data.get("reasoning_flags", []))

            for k in summary_counts:
                summary_counts[k] += data.get("summary", {}).get(k, 0)

        except Exception as exc:
            logging.error("%s failed: %s", module, exc)

    # Assemble final output
    conditional_modules = {
        f"module_{l}_triggered": (trigger_data[l]["triggered"] if trigger_data[l] else False)
        for l in "FGHI"
    }
    conditional_modules["trigger_basis"] = {
        l: (trigger_data[l]["trigger_basis"] if trigger_data[l] else "Not evaluated")
        for l in "FGHI"
    }

    final = {
        "meta": {"rulebook_version": "v3.0", **meta_extra},
        "company_classification": company_classification or {},
        "conditional_modules": conditional_modules,
        "modules": all_modules,
        "reasoning_flags": reasoning_flags,
        "summary": {
            **summary_counts,
            "total_rules_checked": sum(summary_counts.values()),
            "reasoning_flags_total": len(reasoning_flags),
            "critical_flags": _count_by_severity(reasoning_flags, "Critical"),
            "high_flags": _count_by_severity(reasoning_flags, "High"),
            "medium_flags": _count_by_severity(reasoning_flags, "Medium"),
            "overall_assessment": build_overall_assessment(summary_counts, reasoning_flags),
        },
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(final, indent=2, ensure_ascii=False), encoding="utf-8")
    logging.info("Saved → %s", output_path)

    s = final["summary"]
    print(
        f"\n{'='*60}\n"
        f"Analysis complete: {final['meta'].get('company_name', '?')}\n"
        f"{'='*60}\n"
        f"  Present: {s['present']}  Absent: {s['absent']}  "
        f"Insufficient: {s['insufficient']}  N/A: {s['not_applicable']}\n"
        f"  Reasoning flags: {s['reasoning_flags_total']} "
        f"(Crit: {s['critical_flags']} High: {s['high_flags']} Med: {s['medium_flags']})\n"
        f"  Output: {output_path}\n"
        f"{'='*60}"
    )


if __name__ == "__main__":
    main()
