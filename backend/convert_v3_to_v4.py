#!/usr/bin/env python3
"""
Convert checker JSON files from v3 format to v4 format.

v3 format: each rule has status/summary/detail with one combined explanation.
v4 format: rules only included when they have findings; each check_type that
           failed gets its own finding object with check_type/check_label/severity/
           issue_type/explanation/recommendation/source_anchor.

Usage:
    python backend/convert_v3_to_v4.py
"""

import json
from pathlib import Path

_PROJECT_DIR = Path(__file__).parent.parent
_OUTPUT_DIR = _PROJECT_DIR / "Output"

CHECK_LABELS = {
    "D": "Disclosure",
    "T": "Threshold",
    "K": "Consistency",
    "L": "Language",
    "R": "Reasoning",
}

SEVERITY_ORDER = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}


def _highest_severity(severities):
    if not severities:
        return None
    return min(severities, key=lambda s: SEVERITY_ORDER.get(s, 99))


def convert_rule(rule):
    """Convert a v3 rule object to v4. Returns None if Present or Not Applicable."""
    status = rule.get("status", "")
    if status in ("Present", "Not Applicable"):
        return None

    check_types = rule.get("check_types") or ["D"]
    detail = rule.get("detail") or {}
    explanation = detail.get("explanation", "")
    recommendation = detail.get("recommendation", "")
    source_anchor = detail.get("source_anchor") or {
        "source_file": None,
        "page": None,
        "anchor_phrase": None,
    }

    findings = [
        {
            "check_type": ct,
            "check_label": CHECK_LABELS.get(ct, ct),
            "severity": rule.get("severity", "High"),
            "issue_type": status,        # "Absent" | "Insufficient"
            "explanation": explanation,
            "recommendation": recommendation,
            "source_anchor": source_anchor,
        }
        for ct in check_types
    ]

    return {
        "rule_id": rule["rule_id"],
        "rule_description": rule.get("rule_description", ""),
        "findings": findings,
    }


def compute_filter_tags(converted_rules):
    has_d = has_t = has_k = has_l = has_r = False
    severities = []

    for rule in converted_rules:
        for f in rule.get("findings", []):
            ct = f.get("check_type", "")
            if ct == "D":
                has_d = True
            elif ct == "T":
                has_t = True
            elif ct == "K":
                has_k = True
            elif ct == "L":
                has_l = True
            elif ct == "R":
                has_r = True
            sev = f.get("severity", "")
            if sev in SEVERITY_ORDER:
                severities.append(sev)

    return {
        "has_disclosure_issue": has_d,
        "has_threshold_issue": has_t,
        "has_consistency_issue": has_k,
        "has_language_issue": has_l,
        "has_reasoning_issue": has_r,
        "highest_severity": _highest_severity(severities),
    }


def convert_module(module):
    triggered = module.get("triggered", True)

    if not triggered:
        # Derive not_applicable_reason from the first N/A rule explanation
        na_rules = [r for r in module.get("rules", []) if r.get("status") == "Not Applicable"]
        reason = (
            (na_rules[0].get("detail") or {}).get("explanation")
            or f"Module {module.get('module_id')} was not triggered for this applicant."
        )
        return {
            "module_id": module["module_id"],
            "module_name": module.get("module_name", ""),
            "triggered": False,
            "filter_tags": {
                "has_disclosure_issue": False,
                "has_threshold_issue": False,
                "has_consistency_issue": False,
                "has_language_issue": False,
                "has_reasoning_issue": False,
                "highest_severity": None,
            },
            "not_applicable_reason": reason,
            "rules": [],
        }

    converted_rules = [r for r in (convert_rule(rule) for rule in module.get("rules", [])) if r]
    filter_tags = compute_filter_tags(converted_rules)

    return {
        "module_id": module["module_id"],
        "module_name": module.get("module_name", ""),
        "triggered": True,
        "filter_tags": filter_tags,
        "rules": converted_rules,
    }


def convert_reasoning_flag(flag):
    """Flatten v3 detail-nested fields to v4 top-level fields."""
    detail = flag.get("detail") or {}
    return {
        "flag_id": flag["flag_id"],
        "category": flag.get("category", ""),
        "severity": flag.get("severity", "High"),
        "rules_triggered": flag.get("rules_triggered", []),
        "summary": flag.get("summary", ""),
        "explanation": detail.get("explanation", ""),
        "recommendation": detail.get("recommendation", ""),
        "source_anchors": detail.get("source_anchors") or (
            [detail["source_anchor"]] if detail.get("source_anchor") else []
        ),
    }


def compute_summary(v3_summary, converted_modules, converted_flags):
    type_map = {
        "D": "disclosure", "T": "threshold", "K": "consistency",
        "L": "language",   "R": "reasoning",
    }
    by_type = {v: 0 for v in type_map.values()}
    by_sev = {"critical": 0, "high": 0, "medium": 0}
    total_findings = 0

    for mod in converted_modules:
        for rule in mod.get("rules", []):
            for f in rule.get("findings", []):
                total_findings += 1
                ct = f.get("check_type", "")
                if ct in type_map:
                    by_type[type_map[ct]] += 1
                sev = f.get("severity", "").lower()
                if sev in by_sev:
                    by_sev[sev] += 1

    not_applicable = v3_summary.get("not_applicable", 0)
    total_checked = v3_summary.get("total_rules_checked", 0)
    rules_clear = v3_summary.get("present", 0)
    rules_with_issues = (
        v3_summary.get("absent", 0) + v3_summary.get("insufficient", 0)
    )
    total_evaluated = total_checked - not_applicable

    return {
        "total_rules_evaluated": total_evaluated,
        "not_applicable": not_applicable,
        "rules_clear": rules_clear,
        "rules_with_issues": rules_with_issues,
        "total_findings": total_findings,
        "findings_by_type": by_type,
        "findings_by_severity": by_sev,
        "reasoning_flags_total": len(converted_flags),
        "overall_assessment": v3_summary.get("overall_assessment", ""),
    }


def convert_json(data):
    v3_summary = data.get("summary", {})
    converted_modules = [convert_module(m) for m in data.get("modules", [])]
    converted_flags = [convert_reasoning_flag(f) for f in data.get("reasoning_flags", [])]

    return {
        "meta": {**data.get("meta", {}), "rulebook_version": "v4.0"},
        "company_classification": data.get("company_classification", {}),
        "conditional_modules": data.get("conditional_modules", {}),
        "modules": converted_modules,
        "reasoning_flags": converted_flags,
        "summary": compute_summary(v3_summary, converted_modules, converted_flags),
    }


def main():
    json_files = sorted(_OUTPUT_DIR.glob("output*.json"))
    if not json_files:
        print(f"No output*.json files found in {_OUTPUT_DIR}")
        return

    for path in json_files:
        raw = path.read_bytes().decode("utf-8")
        data = json.loads(raw)
        version = data.get("meta", {}).get("rulebook_version", "")
        if version == "v4.0":
            print(f"SKIP  {path.name} — already v4.0")
            continue
        print(f"Converting {path.name} ({version} -> v4.0)...", end=" ")
        converted = convert_json(data)
        path.write_text(json.dumps(converted, indent=2, ensure_ascii=False), encoding="utf-8")
        findings_total = converted["summary"]["total_findings"]
        rules_issues = converted["summary"]["rules_with_issues"]
        print(f"done  ({rules_issues} rules with issues, {findings_total} findings)")

    print("All conversions complete.")


if __name__ == "__main__":
    main()
