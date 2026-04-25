#!/usr/bin/env python3
"""
Save analysis outputs (PDF, JSON, Word doc) to the project Output/ folder.

Each run gets its own numbered set: output1.pdf, output1.json, output1.docx
The number auto-increments based on existing files in Output/.
"""

import json
import shutil
from pathlib import Path

from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

_PROJECT_DIR = Path(__file__).parent.parent
_OUTPUT_DIR = _PROJECT_DIR / "Output"

STATUS_COLOURS = {
    "Present":        RGBColor(0x1a, 0x7a, 0x3c),   # green
    "clear":          RGBColor(0x1a, 0x7a, 0x3c),
    "Absent":         RGBColor(0xcc, 0x00, 0x00),   # red
    "Insufficient":   RGBColor(0xe6, 0x7e, 0x00),   # amber
    "Not Applicable": RGBColor(0x60, 0x60, 0x60),   # grey
    "not_applicable": RGBColor(0x60, 0x60, 0x60),
    "has_issues":     RGBColor(0xe6, 0x7e, 0x00),
}

SEVERITY_COLOURS = {
    "Critical": RGBColor(0xcc, 0x00, 0x00),
    "High":     RGBColor(0xe6, 0x7e, 0x00),
    "Medium":   RGBColor(0x1a, 0x5f, 0xa8),
}


def _next_index() -> int:
    """Return the next unused output index (1-based)."""
    _OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    existing = {p.stem for p in _OUTPUT_DIR.glob("output*.json")}
    n = 1
    while f"output{n}" in existing:
        n += 1
    return n


def _add_heading(doc: Document, text: str, level: int) -> None:
    doc.add_heading(text, level=level)


def _coloured_run(para, text: str, colour: RGBColor, bold: bool = False) -> None:
    run = para.add_run(text)
    run.bold = bold
    run.font.color.rgb = colour


def _build_word_doc(data: dict) -> Document:
    doc = Document()

    meta = data.get("meta", {})
    summary = data.get("summary", {})
    modules = data.get("modules", [])
    flags = data.get("reasoning_flags", [])

    # ── Title ──────────────────────────────────────────────────────────────
    company = meta.get("company_name") or meta.get("issuer") or "Unknown Company"
    title = doc.add_heading(f"IPO Prospectus Analysis — {company}", 0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    date_str = meta.get("analysis_date") or meta.get("timestamp") or ""
    if date_str:
        p = doc.add_paragraph(f"Analysis date: {date_str}")
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.runs[0].font.color.rgb = RGBColor(0x60, 0x60, 0x60)

    doc.add_paragraph()

    # ── Summary ────────────────────────────────────────────────────────────
    _add_heading(doc, "Summary", 1)

    table = doc.add_table(rows=1, cols=2)
    table.style = "Table Grid"

    def add_row(label: str, value) -> None:
        row = table.add_row()
        row.cells[0].text = label
        row.cells[1].text = str(value)

    add_row("Total rules evaluated", summary.get("total_rules_evaluated", summary.get("total_rules_checked", "—")))
    add_row("Rules clear",           summary.get("rules_clear", summary.get("present", "—")))
    add_row("Rules with issues",     summary.get("rules_with_issues", "—"))
    add_row("Not Applicable",      summary.get("not_applicable", "—"))
    add_row("Reasoning flags",     summary.get("reasoning_flags_total", "—"))
    sev = summary.get("findings_by_severity", {})
    add_row("  Critical findings", sev.get("critical", "—"))
    add_row("  High findings",     sev.get("high", "—"))
    add_row("  Medium findings",   sev.get("medium", "—"))

    # Bold header row
    for cell in table.rows[0].cells:
        for run in cell.paragraphs[0].runs:
            run.bold = True

    doc.add_paragraph()

    # ── Modules & Rules ────────────────────────────────────────────────────
    _add_heading(doc, "Modules & Rules", 1)

    for mod in modules:
        mod_id   = mod.get("module_id", "")
        mod_name = mod.get("module_name", mod.get("name", ""))
        _add_heading(doc, f"Module {mod_id}: {mod_name}", 2)

        mod_desc = mod.get("description", "")
        if mod_desc:
            doc.add_paragraph(mod_desc)

        rules = mod.get("rules", [])
        if not rules:
            doc.add_paragraph("No rules in this module.")
            continue

        for rule in rules:
            rule_id   = rule.get("rule_id", rule.get("id", ""))
            rule_name = rule.get("rule_description", rule.get("rule_name", rule.get("name", "")))
            status    = rule.get("status", "")

            # Rule heading line with coloured status
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(6)
            run_id = p.add_run(f"Rule {rule_id}")
            run_id.bold = True
            run_id.font.size = Pt(11)
            if rule_name:
                p.add_run(f" — {rule_name}")
            p.add_run("   ")
            colour = STATUS_COLOURS.get(status, RGBColor(0x33, 0x33, 0x33))
            _coloured_run(p, f"[{status}]", colour, bold=True)

            def add_field(label: str, value) -> None:
                if not value:
                    return
                fp = doc.add_paragraph()
                fp.paragraph_format.left_indent = Pt(18)
                fp.paragraph_format.space_before = Pt(0)
                fp.paragraph_format.space_after = Pt(0)
                r = fp.add_run(f"{label}: ")
                r.bold = True
                r.font.size = Pt(10)
                vr = fp.add_run(str(value))
                vr.font.size = Pt(10)

            add_field("Analysis", rule.get("analysis") or rule.get("finding") or rule.get("analysis"))

            if rule.get("status") in ("clear", "not_applicable"):
                anchor = rule.get("source_anchor") or {}
                add_field("Source", anchor.get("source_file"))
                add_field("Page", anchor.get("page"))
                add_field("Anchor", anchor.get("anchor_phrase"))

            for idx, finding in enumerate(rule.get("findings", []) or [], start=1):
                fp = doc.add_paragraph()
                fp.paragraph_format.left_indent = Pt(18)
                hdr = fp.add_run(
                    f"Finding {idx}: {finding.get('check_label', finding.get('check_type', ''))} "
                    f"[{finding.get('severity', '')} / {finding.get('issue_type', '')}]"
                )
                hdr.bold = True
                hdr.font.size = Pt(10)
                if finding.get("explanation"):
                    add_field("Explanation", finding.get("explanation"))
                if finding.get("recommendation"):
                    add_field("Recommendation", finding.get("recommendation"))
                anchor = finding.get("source_anchor") or {}
                add_field("Source", anchor.get("source_file"))
                add_field("Page", anchor.get("page"))
                add_field("Anchor", anchor.get("anchor_phrase"))

        doc.add_paragraph()

    # ── Reasoning Flags ────────────────────────────────────────────────────
    if flags:
        _add_heading(doc, "Reasoning Flags", 1)

        for flag in flags:
            severity  = flag.get("severity", "")
            rule_ref  = flag.get("rule_id", flag.get("rule", ""))
            flag_title = flag.get("title", flag.get("flag", ""))

            p = doc.add_paragraph()
            sev_colour = SEVERITY_COLOURS.get(severity, RGBColor(0x33, 0x33, 0x33))
            _coloured_run(p, f"[{severity}]", sev_colour, bold=True)
            if rule_ref:
                p.add_run(f"  Rule {rule_ref}")
            if flag_title:
                p.add_run(f" — {flag_title}")

            def add_flag_field(label: str, value) -> None:
                if not value:
                    return
                fp = doc.add_paragraph()
                fp.paragraph_format.left_indent = Pt(18)
                fp.paragraph_format.space_before = Pt(0)
                fp.paragraph_format.space_after = Pt(0)
                r = fp.add_run(f"{label}: ")
                r.bold = True
                r.font.size = Pt(10)
                vr = fp.add_run(str(value))
                vr.font.size = Pt(10)

            add_flag_field("Issue",          flag.get("description") or flag.get("issue"))
            add_flag_field("Recommendation", flag.get("recommendation") or flag.get("action"))

        doc.add_paragraph()

    return doc


def save_outputs(pdf_source: Path, result: dict) -> dict[str, Path]:
    """
    Save pdf_source, result JSON, and a generated Word doc to Output/.

    Returns a dict with keys 'pdf', 'json', 'docx' → absolute Paths.
    """
    n = _next_index()
    stem = f"output{n}"

    json_path = _OUTPUT_DIR / f"{stem}.json"
    pdf_path  = _OUTPUT_DIR / f"{stem}.pdf"
    docx_path = _OUTPUT_DIR / f"{stem}.docx"

    # JSON
    json_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    # PDF (copy from temp)
    shutil.copy2(pdf_source, pdf_path)

    # Word doc
    doc = _build_word_doc(result)
    doc.save(str(docx_path))

    return {"pdf": pdf_path, "json": json_path, "docx": docx_path}
