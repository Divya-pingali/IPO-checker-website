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
from datetime import date
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

CHECK_TYPES = {"D", "T", "K", "L", "R"}
CHECK_LABELS = {
    "D": "Disclosure",
    "T": "Threshold",
    "K": "Consistency",
    "L": "Language",
    "R": "Reasoning",
}
SEVERITIES = {"Critical", "High", "Medium"}
ISSUE_TYPES = {"Absent", "Insufficient"}
RULE_STATUSES = {"clear", "has_issues", "not_applicable"}
REASONING_FLAG_CATEGORIES = {"arithmetic", "cross_reference"}
MARKET_CAP_TIERS = {"< HK$15bn", "HK$15-30bn", "≥ HK$30bn", "Not determinable"}
COMPANY_CLASSIFICATIONS = {"Commercial", "Pre-Commercial", "Not determinable"}
SUMMARY_FINDING_KEYS = {
    "disclosure",
    "threshold",
    "consistency",
    "language",
    "reasoning",
}
SUMMARY_SEVERITY_KEYS = {"critical", "high", "medium"}


def _nullable(schema: dict) -> dict:
    """Return a schema that also allows null."""
    return {"anyOf": [schema, {"type": "null"}]}


CHECKER_RESPONSE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "meta": {
            "type": "object",
            "properties": {
                "rulebook_version": {"type": "string"},
                "company_name": {"type": "string"},
                "analysis_date": {"type": "string"},
            },
            "required": ["rulebook_version", "company_name", "analysis_date"],
            "additionalProperties": True,
        },
        "company_classification": {
            "type": "object",
            "properties": {
                "specialist_technology_industry": {"type": "string"},
                "acceptable_sector": {"type": "string"},
                "commercial_or_precommercial": {"type": "string"},
                "expected_market_cap_hkd_bn": _nullable({"type": "number"}),
                "applicable_market_cap_tier": {"type": "string"},
                "applicable_aggregate_sii_threshold_pct": _nullable({"type": "number"}),
                "classification_notes": {"type": "string"},
            },
            "required": [
                "specialist_technology_industry",
                "acceptable_sector",
                "commercial_or_precommercial",
                "expected_market_cap_hkd_bn",
                "applicable_market_cap_tier",
                "applicable_aggregate_sii_threshold_pct",
                "classification_notes",
            ],
            "additionalProperties": True,
        },
        "conditional_modules": {
            "type": "object",
            "properties": {
                "module_F_triggered": {"type": "boolean"},
                "module_G_triggered": {"type": "boolean"},
                "module_H_triggered": {"type": "boolean"},
                "module_I_triggered": {"type": "boolean"},
                "trigger_basis": {
                    "type": "object",
                    "properties": {
                        "F": {"type": "string"},
                        "G": {"type": "string"},
                        "H": {"type": "string"},
                        "I": {"type": "string"},
                    },
                    "required": ["F", "G", "H", "I"],
                    "additionalProperties": True,
                },
            },
            "required": [
                "module_F_triggered",
                "module_G_triggered",
                "module_H_triggered",
                "module_I_triggered",
                "trigger_basis",
            ],
            "additionalProperties": True,
        },
        "modules": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "module_id": {"type": "string"},
                    "module_name": {"type": "string"},
                    "triggered": {"type": "boolean"},
                    "not_applicable_reason": {"type": "string"},
                    "filter_tags": {
                        "type": "object",
                        "properties": {
                            "has_disclosure_issue": {"type": "boolean"},
                            "has_threshold_issue": {"type": "boolean"},
                            "has_consistency_issue": {"type": "boolean"},
                            "has_language_issue": {"type": "boolean"},
                            "has_reasoning_issue": {"type": "boolean"},
                            "highest_severity": _nullable({"type": "string"}),
                        },
                        "required": [
                            "has_disclosure_issue",
                            "has_threshold_issue",
                            "has_consistency_issue",
                            "has_language_issue",
                            "has_reasoning_issue",
                            "highest_severity",
                        ],
                        "additionalProperties": True,
                    },
                    "rules": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "rule_id": {"type": "string"},
                                "rule_description": {"type": "string"},
                                "status": {"type": "string"},
                                "analysis": {"type": "string"},
                                "source_anchor": _nullable({
                                    "type": "object",
                                    "properties": {
                                        "source_file": _nullable({"type": "string"}),
                                        "page": _nullable({"type": "integer"}),
                                        "anchor_phrase": _nullable({"type": "string"}),
                                    },
                                    "required": ["source_file", "page", "anchor_phrase"],
                                    "additionalProperties": True,
                                }),
                                "findings": {
                                    "type": "array",
                                    "minItems": 1,
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "check_type": {"type": "string"},
                                            "check_label": {"type": "string"},
                                            "severity": {"type": "string"},
                                            "issue_type": {"type": "string"},
                                            "explanation": {"type": "string"},
                                            "recommendation": {"type": "string"},
                                            "source_anchor": {
                                                "type": "object",
                                                "properties": {
                                                    "source_file": _nullable({"type": "string"}),
                                                    "page": _nullable({"type": "integer"}),
                                                    "anchor_phrase": _nullable({"type": "string"}),
                                                },
                                                "required": [
                                                    "source_file",
                                                    "page",
                                                    "anchor_phrase",
                                                ],
                                                "additionalProperties": True,
                                            },
                                        },
                                        "required": [
                                            "check_type",
                                            "check_label",
                                            "severity",
                                            "issue_type",
                                            "explanation",
                                            "recommendation",
                                            "source_anchor",
                                        ],
                                        "additionalProperties": True,
                                    },
                                },
                            },
                            "required": ["rule_id", "rule_description", "status", "analysis"],
                            "additionalProperties": True,
                        },
                    },
                },
                "required": ["module_id", "module_name", "triggered", "filter_tags", "rules"],
                "additionalProperties": True,
            },
        },
        "reasoning_flags": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "flag_id": {"type": "string"},
                    "category": {"type": "string"},
                    "severity": {"type": "string"},
                    "rules_triggered": {"type": "array", "items": {"type": "string"}},
                    "summary": {"type": "string"},
                    "explanation": {"type": "string"},
                    "recommendation": {"type": "string"},
                    "source_anchors": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source_file": _nullable({"type": "string"}),
                                "page": _nullable({"type": "integer"}),
                                "anchor_phrase": _nullable({"type": "string"}),
                            },
                            "required": ["source_file", "page", "anchor_phrase"],
                            "additionalProperties": True,
                        },
                    },
                },
                "required": [
                    "flag_id",
                    "category",
                    "severity",
                    "rules_triggered",
                    "summary",
                    "explanation",
                    "recommendation",
                    "source_anchors",
                ],
                "additionalProperties": True,
            },
        },
        "summary": {
            "type": "object",
            "properties": {
                "total_rules_evaluated": {"type": "integer"},
                "not_applicable": {"type": "integer"},
                "rules_clear": {"type": "integer"},
                "rules_with_issues": {"type": "integer"},
                "total_findings": {"type": "integer"},
                "findings_by_type": {
                    "type": "object",
                    "properties": {
                        "disclosure": {"type": "integer"},
                        "threshold": {"type": "integer"},
                        "consistency": {"type": "integer"},
                        "language": {"type": "integer"},
                        "reasoning": {"type": "integer"},
                    },
                    "required": [
                        "disclosure",
                        "threshold",
                        "consistency",
                        "language",
                        "reasoning",
                    ],
                    "additionalProperties": True,
                },
                "findings_by_severity": {
                    "type": "object",
                    "properties": {
                        "critical": {"type": "integer"},
                        "high": {"type": "integer"},
                        "medium": {"type": "integer"},
                    },
                    "required": ["critical", "high", "medium"],
                    "additionalProperties": True,
                },
                "reasoning_flags_total": {"type": "integer"},
                "overall_assessment": {"type": "string"},
            },
            "required": [
                "total_rules_evaluated",
                "not_applicable",
                "rules_clear",
                "rules_with_issues",
                "total_findings",
                "findings_by_type",
                "findings_by_severity",
                "reasoning_flags_total",
                "overall_assessment",
            ],
            "additionalProperties": True,
        },
    },
    "required": [
        "meta",
        "company_classification",
        "conditional_modules",
        "modules",
        "reasoning_flags",
        "summary",
    ],
    "additionalProperties": True,
}


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
        "and ALL rules within each triggered module. "
        "Return every rule in the output with status clear, has_issues, or not_applicable "
        "exactly as required by Section 5 of the system prompt. "
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


def _default_filter_tags() -> dict:
    return {
        "has_disclosure_issue": False,
        "has_threshold_issue": False,
        "has_consistency_issue": False,
        "has_language_issue": False,
        "has_reasoning_issue": False,
        "highest_severity": None,
    }


def _validate_source_anchor(anchor: object, path: str) -> None:
    if not isinstance(anchor, dict):
        raise ValueError(f"{path} must be an object")
    for key in ("source_file", "page", "anchor_phrase"):
        if key not in anchor:
            raise ValueError(f"{path}.{key} is required")
    if anchor["source_file"] is not None and not isinstance(anchor["source_file"], str):
        raise ValueError(f"{path}.source_file must be a string or null")
    if anchor["page"] is not None and not isinstance(anchor["page"], int):
        raise ValueError(f"{path}.page must be an integer or null")
    if anchor["anchor_phrase"] is not None and not isinstance(anchor["anchor_phrase"], str):
        raise ValueError(f"{path}.anchor_phrase must be a string or null")


def validate_checker_json(data: object) -> None:
    """Validate the v4 checker payload shape before it reaches the UI."""
    if not isinstance(data, dict):
        raise ValueError("Checker response must be a JSON object")

    for key in (
        "meta",
        "company_classification",
        "conditional_modules",
        "modules",
        "reasoning_flags",
        "summary",
    ):
        if key not in data:
            raise ValueError(f"Top-level key '{key}' is required")

    meta = data["meta"]
    if not isinstance(meta, dict):
        raise ValueError("meta must be an object")
    for key in ("rulebook_version", "company_name", "analysis_date"):
        if not isinstance(meta.get(key), str) or not meta[key].strip():
            raise ValueError(f"meta.{key} must be a non-empty string")

    company = data["company_classification"]
    if not isinstance(company, dict):
        raise ValueError("company_classification must be an object")
    if company.get("commercial_or_precommercial") not in COMPANY_CLASSIFICATIONS:
        raise ValueError("company_classification.commercial_or_precommercial is invalid")
    if company.get("applicable_market_cap_tier") not in MARKET_CAP_TIERS:
        raise ValueError("company_classification.applicable_market_cap_tier is invalid")

    conditional = data["conditional_modules"]
    if not isinstance(conditional, dict):
        raise ValueError("conditional_modules must be an object")
    for key in ("module_F_triggered", "module_G_triggered", "module_H_triggered", "module_I_triggered"):
        if not isinstance(conditional.get(key), bool):
            raise ValueError(f"conditional_modules.{key} must be boolean")
    trigger_basis = conditional.get("trigger_basis")
    if not isinstance(trigger_basis, dict):
        raise ValueError("conditional_modules.trigger_basis must be an object")
    for key in ("F", "G", "H", "I"):
        if not isinstance(trigger_basis.get(key), str):
            raise ValueError(f"conditional_modules.trigger_basis.{key} must be a string")

    modules = data["modules"]
    if not isinstance(modules, list):
        raise ValueError("modules must be an array")
    for i, module in enumerate(modules):
        path = f"modules[{i}]"
        if not isinstance(module, dict):
            raise ValueError(f"{path} must be an object")
        if not isinstance(module.get("module_id"), str):
            raise ValueError(f"{path}.module_id must be a string")
        if not isinstance(module.get("module_name"), str):
            raise ValueError(f"{path}.module_name must be a string")
        if not isinstance(module.get("triggered"), bool):
            raise ValueError(f"{path}.triggered must be boolean")

        filter_tags = module.get("filter_tags")
        if not isinstance(filter_tags, dict):
            raise ValueError(f"{path}.filter_tags must be an object")
        for key in (
            "has_disclosure_issue",
            "has_threshold_issue",
            "has_consistency_issue",
            "has_language_issue",
            "has_reasoning_issue",
        ):
            if not isinstance(filter_tags.get(key), bool):
                raise ValueError(f"{path}.filter_tags.{key} must be boolean")
        highest = filter_tags.get("highest_severity")
        if highest is not None and highest not in SEVERITIES:
            raise ValueError(f"{path}.filter_tags.highest_severity is invalid")

        rules = module.get("rules")
        if not isinstance(rules, list):
            raise ValueError(f"{path}.rules must be an array")
        for j, rule in enumerate(rules):
            rule_path = f"{path}.rules[{j}]"
            if not isinstance(rule, dict):
                raise ValueError(f"{rule_path} must be an object")
            if not isinstance(rule.get("rule_id"), str):
                raise ValueError(f"{rule_path}.rule_id must be a string")
            if not isinstance(rule.get("rule_description"), str):
                raise ValueError(f"{rule_path}.rule_description must be a string")
            status = rule.get("status")
            if status not in RULE_STATUSES:
                raise ValueError(f"{rule_path}.status is invalid")
            if not isinstance(rule.get("analysis"), str):
                raise ValueError(f"{rule_path}.analysis must be a string")

            if status in {"clear", "not_applicable"}:
                _validate_source_anchor(rule.get("source_anchor"), f"{rule_path}.source_anchor")
                if "findings" in rule and rule.get("findings") not in (None, []):
                    raise ValueError(f"{rule_path}.findings must be omitted for status={status}")
                continue

            if "source_anchor" in rule and rule.get("source_anchor") not in (None, {}):
                raise ValueError(f"{rule_path}.source_anchor must be omitted for has_issues rules")

            findings = rule.get("findings")
            if not isinstance(findings, list) or not findings:
                raise ValueError(f"{rule_path}.findings must be a non-empty array")
            for k, finding in enumerate(findings):
                finding_path = f"{rule_path}.findings[{k}]"
                if not isinstance(finding, dict):
                    raise ValueError(f"{finding_path} must be an object")
                check_type = finding.get("check_type")
                if check_type not in CHECK_TYPES:
                    raise ValueError(f"{finding_path}.check_type is invalid")
                if finding.get("check_label") != CHECK_LABELS[check_type]:
                    raise ValueError(f"{finding_path}.check_label does not match {check_type}")
                if finding.get("severity") not in SEVERITIES:
                    raise ValueError(f"{finding_path}.severity is invalid")
                if finding.get("issue_type") not in ISSUE_TYPES:
                    raise ValueError(f"{finding_path}.issue_type is invalid")
                for field in ("explanation", "recommendation"):
                    if not isinstance(finding.get(field), str):
                        raise ValueError(f"{finding_path}.{field} must be a string")
                _validate_source_anchor(finding.get("source_anchor"), f"{finding_path}.source_anchor")

    flags = data["reasoning_flags"]
    if not isinstance(flags, list):
        raise ValueError("reasoning_flags must be an array")
    for i, flag in enumerate(flags):
        path = f"reasoning_flags[{i}]"
        if not isinstance(flag, dict):
            raise ValueError(f"{path} must be an object")
        if not isinstance(flag.get("flag_id"), str):
            raise ValueError(f"{path}.flag_id must be a string")
        if flag.get("category") not in REASONING_FLAG_CATEGORIES:
            raise ValueError(f"{path}.category is invalid")
        if flag.get("severity") not in SEVERITIES:
            raise ValueError(f"{path}.severity is invalid")
        if not isinstance(flag.get("rules_triggered"), list):
            raise ValueError(f"{path}.rules_triggered must be an array")
        for field in ("summary", "explanation", "recommendation"):
            if not isinstance(flag.get(field), str):
                raise ValueError(f"{path}.{field} must be a string")
        anchors = flag.get("source_anchors")
        if not isinstance(anchors, list) or len(anchors) != 2:
            raise ValueError(f"{path}.source_anchors must contain exactly two anchors")
        for j, anchor in enumerate(anchors):
            _validate_source_anchor(anchor, f"{path}.source_anchors[{j}]")

    summary = data["summary"]
    if not isinstance(summary, dict):
        raise ValueError("summary must be an object")
    for key in (
        "total_rules_evaluated",
        "not_applicable",
        "rules_clear",
        "rules_with_issues",
        "total_findings",
        "reasoning_flags_total",
    ):
        if not isinstance(summary.get(key), int):
            raise ValueError(f"summary.{key} must be an integer")
    findings_by_type = summary.get("findings_by_type")
    if not isinstance(findings_by_type, dict):
        raise ValueError("summary.findings_by_type must be an object")
    if set(findings_by_type) != SUMMARY_FINDING_KEYS:
        raise ValueError("summary.findings_by_type keys are invalid")
    if not all(isinstance(v, int) for v in findings_by_type.values()):
        raise ValueError("summary.findings_by_type values must be integers")
    findings_by_severity = summary.get("findings_by_severity")
    if not isinstance(findings_by_severity, dict):
        raise ValueError("summary.findings_by_severity must be an object")
    if set(findings_by_severity) != SUMMARY_SEVERITY_KEYS:
        raise ValueError("summary.findings_by_severity keys are invalid")
    if not all(isinstance(v, int) for v in findings_by_severity.values()):
        raise ValueError("summary.findings_by_severity values must be integers")
    if not isinstance(summary.get("overall_assessment"), str):
        raise ValueError("summary.overall_assessment must be a string")

    if summary["reasoning_flags_total"] != len(flags):
        raise ValueError("summary.reasoning_flags_total must equal len(reasoning_flags)")


# ---------------------------------------------------------------------------
# Gemini API call with retry
# ---------------------------------------------------------------------------

def call_gemini(system_prompt: str, user_message: str, model: str, api_key: str,
                max_tokens: int = 32768, max_retries: int = 5,
                thinking_budget: int | None = None) -> str:
    client = genai.Client(api_key=api_key)

    for attempt in range(max_retries):
        try:
            config_kwargs = dict(
                system_instruction=system_prompt,
                max_output_tokens=max_tokens,
                temperature=0.0,
                response_mime_type="application/json",
                response_json_schema=CHECKER_RESPONSE_JSON_SCHEMA,
            )
            if thinking_budget is not None and thinking_budget > 0:
                config_kwargs["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=thinking_budget
                )

            response = client.models.generate_content(
                model=model,
                contents=user_message,
                config=types.GenerateContentConfig(**config_kwargs),
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

def _strip_json_noise(text: str) -> str:
    """Remove common non-JSON noise that models occasionally emit.

    Handles:
      - Markdown code fences (``` / ```json)
      - // line comments
      - /* block comments */
      - Bare ellipsis lines (... or ,...)
      - Trailing commas before ] or }
    """
    import re

    # Strip markdown fences
    if text.startswith("```"):
        lines = text.splitlines()
        # Drop first line (fence open) and last if it closes the fence
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    # Remove /* … */ block comments (non-greedy, dotall)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)

    # Remove // line comments — only when // is not inside a string.
    # Simplified: remove any line whose first non-whitespace chars are //
    text = re.sub(r'(?m)^[ \t]*//[^\n]*$', '', text)

    # Remove lines that are just an ellipsis (model skipping content)
    text = re.sub(r'(?m)^[ \t]*\.\.\.[ \t]*,?[ \t]*$', '', text)

    # Remove corrupted string entries where the model dropped the opening quote,
    # e.g. a line containing  L"  instead of  "L"  (bare word chars + a quote).
    # These never appear in valid JSON, so stripping them is safe.
    text = re.sub(r'(?m)^[ \t]*[A-Za-z0-9_]+"[ \t]*,?[ \t]*$', '', text)

    # Remove trailing commas before ] or } (common when model omits items)
    text = re.sub(r',(\s*[}\]])', r'\1', text)

    return text


def clean_json(text: str) -> dict:
    text = text.strip()
    text = _strip_json_noise(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        # Log the offending area to help diagnose future issues
        start = max(0, exc.pos - 120)
        end   = min(len(text), exc.pos + 120)
        logging.error("JSON parse error at char %d: …%r…", exc.pos, text[start:end])
        raise


def _count_by_severity(items: list[dict], severity: str) -> int:
    return sum(1 for x in items if x.get("severity") == severity)


def finalize_checker_json(final: dict) -> dict:
    """Backfill a few deterministic fields, then validate the final payload."""
    final.setdefault("meta", {})
    final["meta"].setdefault("rulebook_version", "v4.0")
    final["meta"].setdefault("analysis_date", date.today().isoformat())

    final.setdefault("reasoning_flags", [])
    final.setdefault("modules", [])
    final.setdefault("summary", {})

    cleaned_modules = []
    for module in final["modules"]:
        if not isinstance(module, dict):
            continue
        raw_rules = module.get("rules", [])
        if not isinstance(raw_rules, list):
            raw_rules = []

        cleaned_rules = []
        for rule in raw_rules:
            if not isinstance(rule, dict):
                continue
            status = rule.get("status")
            if status not in RULE_STATUSES:
                if isinstance(rule.get("findings"), list) and rule.get("findings"):
                    status = "has_issues"
                else:
                    continue
            rule["status"] = status
            rule.setdefault("analysis", "")

            if status == "has_issues":
                findings = rule.get("findings", [])
                if not isinstance(findings, list):
                    findings = []
                findings = [f for f in findings if isinstance(f, dict)]
                if not findings:
                    continue
                rule["findings"] = findings
                rule.pop("source_anchor", None)
            else:
                if not isinstance(rule.get("source_anchor"), dict):
                    rule["source_anchor"] = {
                        "source_file": None,
                        "page": None,
                        "anchor_phrase": None,
                    }
                rule.pop("findings", None)
            cleaned_rules.append(rule)

        module["rules"] = cleaned_rules
        type_map = {
            "D": "has_disclosure_issue",
            "T": "has_threshold_issue",
            "K": "has_consistency_issue",
            "L": "has_language_issue",
            "R": "has_reasoning_issue",
        }
        filter_tags = _default_filter_tags()
        severities = []
        for rule in cleaned_rules:
            if rule.get("status") != "has_issues":
                continue
            for finding in rule.get("findings", []):
                mapped = type_map.get(finding.get("check_type"))
                if mapped:
                    filter_tags[mapped] = True
                sev = finding.get("severity")
                if sev in SEVERITIES:
                    severities.append(sev)
        if severities:
            order = {"Critical": 0, "High": 1, "Medium": 2}
            filter_tags["highest_severity"] = min(severities, key=lambda s: order[s])
        module["filter_tags"] = filter_tags
        cleaned_modules.append(module)

    final["modules"] = cleaned_modules

    modules = final.get("modules", [])
    summary = final.setdefault("summary", {})
    if modules:
        all_findings = [
            f
            for m in modules
            for r in m.get("rules", [])
            for f in r.get("findings", [])
        ]
        all_rules = [r for m in modules for r in m.get("rules", [])]
        type_map = {
            "D": "disclosure",
            "T": "threshold",
            "K": "consistency",
            "L": "language",
            "R": "reasoning",
        }
        by_type = {v: 0 for v in type_map.values()}
        by_sev = {"critical": 0, "high": 0, "medium": 0}
        for finding in all_findings:
            ct = finding.get("check_type", "")
            if ct in type_map:
                by_type[type_map[ct]] += 1
            sev = finding.get("severity", "").lower()
            if sev in by_sev:
                by_sev[sev] += 1
        summary.update({
            "total_rules_evaluated": sum(1 for r in all_rules if r.get("status") != "not_applicable"),
            "not_applicable": sum(1 for r in all_rules if r.get("status") == "not_applicable"),
            "rules_clear": sum(1 for r in all_rules if r.get("status") == "clear"),
            "rules_with_issues": sum(1 for r in all_rules if r.get("status") == "has_issues"),
            "total_findings": len(all_findings),
            "findings_by_type": by_type,
            "findings_by_severity": by_sev,
            "reasoning_flags_total": len(final.get("reasoning_flags", [])),
        })

    validate_checker_json(final)
    return final


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--extraction-dir", required=True,
                        help="Directory with tier1/ and tier2/ from extract_sections.py")
    parser.add_argument("--prompt",
                        default=str(_REFERENCE_DIR / "rulebook_prompt_v4.md"),
                        help="Path to rulebook_prompt_v4.md (default: reference/)")
    parser.add_argument("--output",
                        default=str(_PUBLIC_DIR / "checker.json"),
                        help="Output checker.json path (default: public/checker.json)")
    parser.add_argument("--model", default="gemini-2.5-pro")
    parser.add_argument("--api-key")
    parser.add_argument("--max-tokens", type=int, default=32768,
                        help="Max output tokens (default: 32768)")
    parser.add_argument(
        "--thinking-budget",
        type=int,
        default=0,
        help=(
            "Gemini thinking budget. Default 0 disables forced thinking so results "
            "stay closer to the leaner output style used in earlier runs."
        ),
    )
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
    thinking_budget = args.thinking_budget if args.thinking_budget > 0 else None
    logging.info(
        "Calling Gemini (%s) — thinking budget: %s — this may take a few minutes…",
        args.model,
        thinking_budget if thinking_budget is not None else "default/off",
    )
    raw = call_gemini(
        system_prompt,
        user_message,
        args.model,
        api_key,
        args.max_tokens,
        thinking_budget=thinking_budget,
    )
    logging.info("Response received: %d chars", len(raw))

    # Parse and validate
    try:
        final = clean_json(raw)
    except json.JSONDecodeError as exc:
        logging.error("Failed to parse Gemini response as JSON: %s", exc)
        logging.error("Raw response (first 2000 chars): %s", raw[:2000])
        sys.exit(1)

    # Backfill deterministic fields and validate the final payload shape.
    try:
        final = finalize_checker_json(final)
    except ValueError as exc:
        logging.error("Checker JSON failed validation: %s", exc)
        logging.error("Validated response (first 2000 chars): %s", json.dumps(final, ensure_ascii=False)[:2000])
        sys.exit(1)

    # Write output
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(final, indent=2, ensure_ascii=False), encoding="utf-8")
    logging.info("Saved → %s", output_path)

    modules = final.get("modules", [])
    s = final.get("summary", {})
    by_sev = s.get("findings_by_severity", {})
    print(
        f"\n{'='*60}\n"
        f"Analysis complete: {final.get('meta', {}).get('company_name', '?')}\n"
        f"{'='*60}\n"
        f"  Modules: {len(modules)}\n"
        f"  Rules clear: {s.get('rules_clear', '?')}  "
        f"Rules with issues: {s.get('rules_with_issues', '?')}  "
        f"N/A: {s.get('not_applicable', '?')}\n"
        f"  Total findings: {s.get('total_findings', '?')} "
        f"(Crit: {by_sev.get('critical', '?')} "
        f"High: {by_sev.get('high', '?')} "
        f"Med: {by_sev.get('medium', '?')})\n"
        f"  Reasoning flags: {s.get('reasoning_flags_total', '?')}\n"
        f"  Output: {output_path}\n"
        f"{'='*60}"
    )


if __name__ == "__main__":
    main()
