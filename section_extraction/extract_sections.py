#!/usr/bin/env python3
"""
Stage 1: Section Extraction for HKEX Chapter 18C Prospectus Compliance Checker.

Accepts PDF or Word (.docx) prospectus files. Word files are converted to PDF
via LibreOffice headless before extraction so that page numbers remain accurate.

Extraction pipeline:
1. Locate and parse the Table of Contents
2. Detect the printed-page-number offset
3. Match ToC entries against a known section library
4. Extract body text for each matched section, inserting [Page N] markers
5. Output structured JSON with extraction metadata and warnings
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import string
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

def derive_module_id(title):
    s = title.lower()
    s = s.translate(str.maketrans('', '', string.punctuation))
    s = re.sub(r'\s+', '_', s)
    return s[:60]

def is_title_case(s):
    # A simple heuristic for Title Case
    words = s.split()
    if not words:
        return False
    title_words = [w for w in words if w.istitle() or w.isupper()]
    return len(title_words) / len(words) >= 0.5

def extract_text_with_error_handling(pdf, page_num, manifest):
    try:
        # pdfplumber pages are 0-indexed
        if page_num - 1 < 0 or page_num - 1 >= len(pdf.pages):
            return ""
        page = pdf.pages[page_num - 1]
        return page.extract_text() or ""
    except Exception as e:
        manifest.setdefault("extraction_errors", []).append({"page": page_num, "error": str(e)})
        return ""

def write_json(path, data):
    if os.path.exists(path):
        print(f"[INFO] Overwriting existing file: {path}")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# ---------------------------------------------------------------------------
# DOCX → PDF conversion
# ---------------------------------------------------------------------------
def convert_docx_to_pdf(docx_path, keep_pdf=False, verbose=False):
    """Convert a .docx file to PDF using LibreOffice headless.

    Returns the path to the generated PDF. If keep_pdf is False, the PDF is
    written to a temporary directory and the caller is responsible for cleanup.
    If keep_pdf is True, the PDF is placed alongside the original .docx file.
    """
    if shutil.which("libreoffice") is None:
        print("ERROR: LibreOffice is required to process .docx files but was "
              "not found on PATH.\n"
              "Install it with:\n"
              "  Ubuntu/Debian: sudo apt install libreoffice\n"
              "  macOS:         brew install --cask libreoffice\n"
              "  Windows:       https://www.libreoffice.org/download/",
              file=sys.stderr)
        sys.exit(1)

    if keep_pdf:
        out_dir = os.path.dirname(os.path.abspath(docx_path)) or "."
    else:
        out_dir = tempfile.mkdtemp(prefix="prospectus_")

    if verbose:
        print(f"Converting {docx_path} to PDF via LibreOffice...")

    result = subprocess.run(
        ["libreoffice", "--headless", "--convert-to", "pdf",
         "--outdir", out_dir, os.path.abspath(docx_path)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"ERROR: LibreOffice conversion failed:\n{result.stderr}",
              file=sys.stderr)
        sys.exit(1)

    base = os.path.splitext(os.path.basename(docx_path))[0]
    pdf_path = os.path.join(out_dir, base + ".pdf")
    if not os.path.isfile(pdf_path):
        print(f"ERROR: Expected converted PDF not found at {pdf_path}",
              file=sys.stderr)
        sys.exit(1)

    if verbose:
        print(f"Converted PDF: {pdf_path}")
    return pdf_path


# ---------------------------------------------------------------------------
# Section name library – maps canonical labels to known ToC heading variants
# ---------------------------------------------------------------------------
SECTION_LIBRARY = {
    "history_corporate_structure": [
        "history and corporate structure",
        "history, development, and corporate structure",
        "history, development and corporate structure",
        "our history",
    ],
    "relationship_controlling_shareholder": [
        "relationship with our single largest shareholder",
        "relationship with our controlling shareholders",
        "relationship with our controlling shareholder",
    ],
    "directors_management": [
        "directors and senior management",
        "directors, supervisors and senior management",
        "directors and management",
    ],
    "substantial_shareholders": [
        "substantial shareholders",
    ],
    "share_capital": [
        "share capital",
    ],
    "cornerstone_investors": [
        "cornerstone investors",
        "cornerstone investor",
    ],
    "appendix_statutory": [
        "statutory and general information",
    ],
}

# Priority tiers for missing-section warnings
CRITICAL = ["history_corporate_structure"]
REQUIRED = [
    "relationship_controlling_shareholder",
    "directors_management",
    "substantial_shareholders",
    "share_capital",
]
SUPPLEMENTARY = ["cornerstone_investors", "appendix_statutory"]


# ---------------------------------------------------------------------------
# 1. Printed page offset detection
# ---------------------------------------------------------------------------
def detect_printed_page_offset(pdf, scan_pages=30):
    """Find the PDF page index where printed page "1" begins.

    Strategy: scan the bottom quarter of each of the first *scan_pages* PDF
    pages for a standalone "1".  The first match gives us the offset —
    i.e. printed_page = pdf_page_index - offset.
    """
    num_pages = len(pdf.pages)
    for idx in range(min(scan_pages, num_pages)):
        page = pdf.pages[idx]
        height = page.height
        # Crop to the bottom quarter of the page (footer area)
        footer = page.crop((0, height * 0.75, page.width, height))
        text = footer.extract_text() or ""
        # Look for a standalone "1" (possibly surrounded by dashes / whitespace)
        # Common patterns: "1", "– 1 –", "- 1 -", "—1—"
        if re.search(r'(?:^|[\s\-–—])1(?:[\s\-–—]|$)', text):
            return idx
    # Fallback: if we never find it, assume no offset
    return 0


# ---------------------------------------------------------------------------
# 2. ToC extraction and parsing
# ---------------------------------------------------------------------------
def extract_toc_pages(pdf, max_scan=20):
    """Identify which PDF pages contain the Table of Contents.

    Returns a list of 0-indexed PDF page indices that are part of the ToC.
    Heuristic: a ToC page contains multiple lines that end with a number
    (the printed page reference) and often contains the phrase
    "contents" or "table of contents" near the top.
    """
    toc_pages = []
    num_pages = len(pdf.pages)

    # First pass: find the page that has "CONTENTS" / "TABLE OF CONTENTS"
    toc_start = None
    for idx in range(min(max_scan, num_pages)):
        text = pdf.pages[idx].extract_text() or ""
        upper = text.upper()
        if "TABLE OF CONTENTS" in upper or re.match(r'^\s*CONTENTS\s*$', upper, re.MULTILINE):
            toc_start = idx
            break

    if toc_start is None:
        # Fallback: look for pages with many lines ending in numbers (page refs)
        for idx in range(min(max_scan, num_pages)):
            text = pdf.pages[idx].extract_text() or ""
            lines = text.strip().splitlines()
            page_ref_lines = sum(
                1 for line in lines if re.search(r'\d+\s*$', line.strip())
            )
            if page_ref_lines >= 5:
                toc_start = idx
                break

    if toc_start is None:
        return []

    # Second pass: collect consecutive ToC pages starting from toc_start
    for idx in range(toc_start, min(toc_start + 15, num_pages)):
        text = pdf.pages[idx].extract_text() or ""
        lines = text.strip().splitlines()
        if not lines:
            break
        page_ref_lines = sum(
            1 for line in lines if re.search(r'\d+\s*$', line.strip())
        )
        # A ToC page should have a decent fraction of lines ending with numbers
        if page_ref_lines >= 3:
            toc_pages.append(idx)
        elif toc_pages:
            # We've left the ToC region
            break

    return toc_pages


def parse_toc_entries(pdf, toc_pages):
    """Parse ToC pages into a list of (heading_text, printed_page_number) tuples.

    Each ToC line typically looks like:
        History and Corporate Structure .............. 167
    We extract the heading and the trailing page number.
    """
    entries = []
    for idx in toc_pages:
        text = pdf.pages[idx].extract_text() or ""
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            # Match lines ending with a page number, possibly preceded by dots/spaces
            match = re.match(r'^(.+?)\s*[.\s·…]{2,}\s*(\d+)\s*$', line)
            if not match:
                # Also try: heading followed by just spaces and a number
                match = re.match(r'^(.+?)\s{3,}(\d+)\s*$', line)
            if match:
                heading = match.group(1).strip()
                page_num = int(match.group(2))
                # Skip lines that are clearly sub-items with very short headings
                # or just page numbers
                if len(heading) > 2:
                    entries.append((heading, page_num))
    return entries


# ---------------------------------------------------------------------------
# 3. Section matching against the library
# ---------------------------------------------------------------------------
def match_sections(toc_entries):
    """Match ToC entries against SECTION_LIBRARY using case-insensitive partial matching.

    Returns a dict: {section_label: (heading_as_found, printed_start_page)}
    """
    matched = {}
    for label, variants in SECTION_LIBRARY.items():
        for heading, page_num in toc_entries:
            heading_lower = heading.lower()
            for variant in variants:
                if variant in heading_lower:
                    # Prefer the first (earliest) match
                    if label not in matched:
                        matched[label] = (heading, page_num)
                    break
            if label in matched:
                break
    return matched


def determine_end_pages(matched_sections, toc_entries, total_pdf_pages, offset):
    """Determine the end page for each matched section.

    The end page is the page before the next ToC entry starts, or the last page
    of the document for the final section.
    """
    # Build a sorted list of all ToC entry start pages
    all_starts = sorted(set(page for _, page in toc_entries))

    result = {}
    for label, (heading, start_page) in matched_sections.items():
        # Find the next ToC entry that starts after this section
        end_page = None
        for s in all_starts:
            if s > start_page:
                end_page = s - 1
                break
        if end_page is None:
            # Last section — runs to end of document
            end_page = total_pdf_pages - offset
        result[label] = {
            "heading_as_found": heading,
            "printed_start_page": start_page,
            "printed_end_page": end_page,
        }
    return result


# ---------------------------------------------------------------------------
# 4. Text extraction with page markers
# ---------------------------------------------------------------------------
def extract_section_text(pdf, printed_start, printed_end, offset):
    """Extract text for a section, inserting [Page N] markers at each page boundary.

    Args:
        pdf: open pdfplumber PDF object
        printed_start: first printed page number of the section
        printed_end: last printed page number of the section
        offset: printed_page_offset (pdf_page_index = printed_page + offset)
    """
    parts = []
    for printed_page in range(printed_start, printed_end + 1):
        pdf_idx = printed_page + offset
        if pdf_idx < 0 or pdf_idx >= len(pdf.pages):
            continue
        page_text = pdf.pages[pdf_idx].extract_text() or ""
        parts.append(f"[Page {printed_page}] {page_text}")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# 5. CLI override parsing
# ---------------------------------------------------------------------------
def parse_overrides(override_list):
    """Parse --override arguments of the form section_label=start-end.

    Returns a dict: {section_label: (printed_start, printed_end)}
    """
    overrides = {}
    if not override_list:
        return overrides
    for item in override_list:
        match = re.match(r'^(\w+)=(\d+)-(\d+)$', item)
        if not match:
            print(f"WARNING: Invalid override format '{item}', expected label=start-end",
                  file=sys.stderr)
            continue
        label = match.group(1)
        if label not in SECTION_LIBRARY:
            print(f"WARNING: Unknown section label '{label}' in override", file=sys.stderr)
            continue
        overrides[label] = (int(match.group(2)), int(match.group(3)))
    return overrides


# ---------------------------------------------------------------------------
# 6. Missing section reporting
# ---------------------------------------------------------------------------
def report_missing_sections(found_labels, verbose=False):
    """Classify missing sections by priority tier and print warnings."""
    all_labels = set(SECTION_LIBRARY.keys())
    found = set(found_labels)
    missing = all_labels - found

    missing_critical = [s for s in CRITICAL if s in missing]
    missing_required = [s for s in REQUIRED if s in missing]
    missing_supplementary = [s for s in SUPPLEMENTARY if s in missing]

    for label in missing_critical:
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"  CRITICAL SECTION MISSING: {label}", file=sys.stderr)
        print(f"{'='*60}\n", file=sys.stderr)

    for label in missing_required:
        print(f"WARNING: Required section missing: {label}", file=sys.stderr)

    if verbose:
        for label in missing_supplementary:
            print(f"Note: Supplementary section missing: {label}", file=sys.stderr)

    return missing_critical, missing_required, missing_supplementary


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
def run_extraction(pdf_path, output_path=None, overrides=None, verbose=False,
                   original_file=None):
    """Execute the full extraction pipeline and write JSON output.

    Args:
        pdf_path: Path to the PDF to process (may be a converted temp file).
        original_file: Path to the original input file if it was converted
                       from another format (e.g. .docx). Used for metadata only.
    """
    overrides = overrides or {}
    source_file = original_file or pdf_path

    if verbose:
        print(f"Opening PDF: {pdf_path}")

    with pdfplumber.open(pdf_path) as pdf:
        total_pdf_pages = len(pdf.pages)

        # Step 1: Detect printed page offset
        offset = detect_printed_page_offset(pdf)
        if verbose:
            print(f"Detected printed page offset: {offset} "
                  f"(PDF page {offset} = printed page 1)")

        # Step 2: Find and parse ToC
        toc_pages = extract_toc_pages(pdf)
        toc_found = len(toc_pages) > 0
        if verbose:
            print(f"ToC found: {toc_found}, ToC PDF pages: {toc_pages}")

        toc_entries = []
        if toc_found:
            toc_entries = parse_toc_entries(pdf, toc_pages)
            if verbose:
                print(f"Parsed {len(toc_entries)} ToC entries")
                for heading, page in toc_entries:
                    print(f"  {heading} ... {page}")

        # Step 3: Match sections
        matched = match_sections(toc_entries)
        if verbose:
            print(f"\nMatched sections: {list(matched.keys())}")

        # Step 4: Determine end pages for each section
        section_ranges = determine_end_pages(matched, toc_entries, total_pdf_pages, offset)

        # Step 5: Apply manual overrides
        for label, (start, end) in overrides.items():
            section_ranges[label] = {
                "heading_as_found": f"[manual override] {label}",
                "printed_start_page": start,
                "printed_end_page": end,
            }
            if verbose:
                print(f"Override applied: {label} = pages {start}-{end}")

        # Step 6: Extract text for each section
        sections_output = []
        for label, info in section_ranges.items():
            start = info["printed_start_page"]
            end = info["printed_end_page"]
            pdf_start = start + offset
            pdf_end = end + offset

            text = extract_section_text(pdf, start, end, offset)

            confidence = "manual_override" if label in overrides else "toc_matched"

            sections_output.append({
                "section_label": label,
                "heading_as_found": info["heading_as_found"],
                "printed_start_page": start,
                "printed_end_page": end,
                "pdf_start_page": pdf_start,
                "pdf_end_page": pdf_end,
                "confidence": confidence,
                "text": text,
            })

            if verbose:
                print(f"Extracted: {label} (printed pp. {start}-{end}, "
                      f"{end - start + 1} pages)")

        # Step 7: Report missing sections
        found_labels = [s["section_label"] for s in sections_output]
        missing_critical, missing_required, missing_supplementary = \
            report_missing_sections(found_labels, verbose=verbose)

        # Step 8: Build output JSON
        output = {
            "metadata": {
                "prospectus_file": source_file,
                "converted_from_docx": original_file is not None,
                "extraction_timestamp": datetime.now(timezone.utc)
                    .strftime("%Y-%m-%dT%H:%M:%S"),
                "total_pdf_pages": total_pdf_pages,
                "printed_page_offset": offset,
                "toc_found": toc_found,
                "toc_pdf_pages": toc_pages,
            },
            "extraction_summary": {
                "sections_found": found_labels,
                "sections_missing": sorted(
                    set(SECTION_LIBRARY.keys()) - set(found_labels)
                ),
                "missing_critical": missing_critical,
                "missing_required": missing_required,
                "missing_supplementary": missing_supplementary,
            },
            "sections": sections_output,
        }

        # Step 9: Write output
        if output_path is None:
            output_path = source_file.rsplit(".", 1)[0] + "_extracted.json"

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

        print(f"\nExtraction complete → {output_path}")
        print(f"  Sections found: {len(found_labels)}/{len(SECTION_LIBRARY)}")
        if missing_critical:
            print(f"  CRITICAL missing: {missing_critical}")
        if missing_required:
            print(f"  Required missing: {missing_required}")

        return output


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Extract sections from an HKEX Chapter 18C prospectus "
                    "(PDF or Word .docx) for downstream compliance checking."
    )
    parser.add_argument(
        "input_file",
        help="Path to the prospectus file (.pdf or .docx)",
    )
    parser.add_argument(
        "--output", "-o",
        help="Output JSON file path (default: <input_name>_extracted.json)",
    )
    parser.add_argument(
        "--override",
        nargs="*",
        help="Manual page overrides: section_label=start-end (printed pages). "
             "Example: history_corporate_structure=167-203",
    )
    parser.add_argument(
        "--keep-pdf",
        action="store_true",
        help="When converting from .docx, keep the generated PDF alongside "
             "the original file (default: use a temp file and discard it)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Print detailed progress and matching info",
    )

    args = parser.parse_args()

    input_path = args.input_file
    ext = os.path.splitext(input_path)[1].lower()

    if ext not in (".pdf", ".docx"):
        print(f"ERROR: Unsupported file type '{ext}'. "
              "Provide a .pdf or .docx file.", file=sys.stderr)
        sys.exit(1)

    overrides = parse_overrides(args.override)
    original_file = None
    temp_dir = None

    try:
        if ext == ".docx":
            original_file = input_path
            pdf_path = convert_docx_to_pdf(
                input_path, keep_pdf=args.keep_pdf, verbose=args.verbose
            )
            if not args.keep_pdf:
                temp_dir = os.path.dirname(pdf_path)
        else:
            pdf_path = input_path

        run_extraction(
            pdf_path, args.output, overrides, args.verbose,
            original_file=original_file,
        )
    finally:
        if temp_dir and os.path.isdir(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
def main():
    parser = argparse.ArgumentParser(description="Two-Tier Modular Extraction for Prospectus")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("--output-dir", default="./extracted/", help="Output directory")
    parser.add_argument("--toc-pages", default="1-15", help="Pages to search for TOC")
    parser.add_argument("--toc-fallback", action="store_true", help="Skip TOC parsing")
    parser.add_argument("--chapter-map", help="JSON string for manual TOC")
    parser.add_argument("--tier2-chapter", help="Manually specify SII host chapter module_id")
    parser.add_argument("--tier1-only", action="store_true", help="Run Tier 1 only")
    parser.add_argument("--tier2-only", action="store_true", help="Run Tier 2 only")
    parser.add_argument("--modules", help="Extract only these specific Tier 2 module IDs (comma-separated)")
    parser.add_argument("--min-chars", type=int, default=200, help="Minimum character count to save a module")
    parser.add_argument("--verbose", action="store_true", help="Print per-page progress")

    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    tier1_dir = output_dir / "tier1"
    tier2_dir = output_dir / "tier2"
    
    tier1_dir.mkdir(parents=True, exist_ok=True)
    tier2_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "prospectus_file": os.path.basename(args.pdf_path),
        "extraction_timestamp": datetime.now(timezone.utc).isoformat(),
        "total_pages": 0,
        "toc_parsed": False,
        "toc_entry_count": 0,
        "sii_host_chapter": None,
        "sii_host_promoted_from_tier1": False,
        "tier1_modules": [],
        "tier1_modules_skipped": [],
        "tier2_modules": [],
        "tier2_modules_not_found": [],
        "boundary_conflicts": [],
        "combined_text_tier2": "",
        "module_index": {},
        "extraction_errors": []
    }

    try:
        pdf = pdfplumber.open(args.pdf_path)
    except Exception as e:
        print(f"Error opening PDF: {e}")
        sys.exit(1)

    total_pages = len(pdf.pages)
    manifest["total_pages"] = total_pages

    toc_entries = []

    if args.tier2_only:
        toc_path = output_dir / "toc.json"
        if toc_path.exists():
            with open(toc_path, "r", encoding="utf-8") as f:
                toc_entries = json.load(f)
            manifest["toc_parsed"] = True
            manifest["toc_entry_count"] = len(toc_entries)
        else:
            print("[ERROR] toc.json not found for --tier2-only run.")
            sys.exit(1)
    elif args.toc_fallback and args.chapter_map:
        try:
            cmap = json.loads(args.chapter_map)
            for title, page in cmap.items():
                toc_entries.append({"title": title, "page": page})
            toc_entries.sort(key=lambda x: x["page"])
        except Exception as e:
            print(f"[ERROR] Failed to parse --chapter-map: {e}")
            sys.exit(1)
    else:
        # Stage 0: Parse TOC
        try:
            start_p, end_p = map(int, args.toc_pages.split("-"))
        except:
            start_p, end_p = 1, 15
        
        toc_regex = re.compile(r'^(.+?)[\s\.]{3,}(\d+)\s*$')
        
        for p in range(start_p, min(end_p + 1, total_pages + 1)):
            text = extract_text_with_error_handling(pdf, p, manifest)
            lines = [line.strip() for line in text.split('\n') if line.strip()]
            
            matches = []
            for line in lines:
                m = toc_regex.match(line)
                if m:
                    matches.append({"title": m.group(1).strip(), "page": int(m.group(2))})
            
            if len(matches) > 6:
                toc_entries.extend(matches)
        
        toc_entries.sort(key=lambda x: x["page"])
        
        if len(toc_entries) < 5:
            print("[WARN] TOC parsing found fewer than 5 entries. Consider using --toc-fallback and --chapter-map.")
        else:
            manifest["toc_parsed"] = True
            manifest["toc_entry_count"] = len(toc_entries)
            write_json(output_dir / "toc.json", toc_entries)

    if not toc_entries:
        print("[ERROR] No TOC entries found or provided.")
        sys.exit(1)

    # Infer end pages
    for i in range(len(toc_entries)):
        if i + 1 < len(toc_entries):
            toc_entries[i]["end_page"] = toc_entries[i+1]["page"] - 1
        else:
            toc_entries[i]["end_page"] = total_pages
        toc_entries[i]["module_id"] = derive_module_id(toc_entries[i]["title"])

    # Stage 1: Tier 1
    if not args.tier2_only:
        for entry in toc_entries:
            mod_id = entry["module_id"]
            start_page = entry["page"]
            end_page = entry["end_page"]
            
            if args.verbose:
                print(f"Extracting Tier 1: {mod_id} (Pages {start_page}-{end_page})")
                
            page_blocks = []
            full_text_parts = []
            char_count = 0
            
            for p in range(start_page, end_page + 1):
                page_text = extract_text_with_error_handling(pdf, p, manifest)
                if page_text:
                    page_blocks.append({"page": p, "text": page_text})
                    marked_text = f"[Page {p}]\n{page_text}"
                    full_text_parts.append(marked_text)
                    char_count += len(page_text)
            
            full_text = "\n".join(full_text_parts)
            stripped_text = full_text.strip()
            
            if len(stripped_text) < args.min_chars:
                manifest["tier1_modules_skipped"].append(f"{mod_id}: < {args.min_chars} chars")
                continue
                
            manifest["tier1_modules"].append(mod_id)
            manifest["module_index"][mod_id] = {
                "tier": 1,
                "start_page": start_page,
                "end_page": end_page,
                "char_count": len(full_text)
            }
            
            out_data = {
                "module_id": mod_id,
                "tier": 1,
                "toc_title": entry["title"],
                "start_page": start_page,
                "end_page": end_page,
                "char_count": len(full_text),
                "page_blocks": page_blocks,
                "text": full_text
            }
            write_json(tier1_dir / f"{mod_id}.json", out_data)

    # Stage 2: Tier 2
    if not args.tier1_only:
        sii_host_entry = None
        is_standalone = False
        
        if args.tier2_chapter:
            for entry in toc_entries:
                if entry["module_id"] == args.tier2_chapter:
                    sii_host_entry = entry
                    break
        else:
            # Search for history/development/corporate structure
            for entry in toc_entries:
                title_lower = entry["title"].lower()
                if any(k in title_lower for k in ["history", "development", "corporate structure", "reorganisation"]):
                    sii_host_entry = entry
                    break
            
            if not sii_host_entry:
                for entry in toc_entries:
                    title_lower = entry["title"].lower()
                    if any(k in title_lower for k in ["third party investment", "pre-ipo"]):
                        sii_host_entry = entry
                        is_standalone = True
                        break
        
        if not sii_host_entry:
            print("[WARN] Could not identify SII host chapter. Tier 2 extraction skipped. Run with --tier2-chapter <module_id> to specify manually.")
        else:
            sii_mod_id = sii_host_entry["module_id"]
            manifest["sii_host_chapter"] = sii_mod_id
            
            if is_standalone:
                manifest["sii_host_promoted_from_tier1"] = True
                # Read tier 1 file if exists, else extract
                t1_path = tier1_dir / f"{sii_mod_id}.json"
                if t1_path.exists():
                    with open(t1_path, "r", encoding="utf-8") as f:
                        t1_data = json.load(f)
                    t1_data["tier"] = 2
                    t1_data["promoted_from_tier1"] = True
                    write_json(tier2_dir / f"{sii_mod_id}.json", t1_data)
                    manifest["tier2_modules"].append(sii_mod_id)
                    manifest["module_index"][sii_mod_id] = {
                        "tier": 2,
                        "start_page": t1_data["start_page"],
                        "end_page": t1_data["end_page"],
                        "char_count": t1_data["char_count"]
                    }
                    manifest["combined_text_tier2"] += f"\n[MODULE: {sii_mod_id}]\n{t1_data['text']}"
                else:
                    print(f"[WARN] Standalone chapter {sii_mod_id} not found in tier1.")
            else:
                # Subsection detection
                target_table = [
                    ("sii_disclosure", ["third party investment", "sophisticated independent investor", "independent third party"]),
                    ("pathfinder_sii", ["pathfinder", "pathfinder sii", "pathfinder investor"]),
                    ("pre_ipo_investment", ["pre-ipo investment", "pre-ipo investor", "pre-ipo placing", "pre-ipo shareholders"]),
                    ("cornerstone_placing", ["cornerstone investor", "cornerstone placing", "cornerstone"]),
                    ("history_of_group", ["history of the group", "history and development", "overview of our history", "establishment"]),
                    ("reorganisation", ["reorganisation", "reorganization", "group reorganisation"]),
                    ("corporate_structure_chart", ["corporate structure", "group structure", "our structure"])
                ]
                
                allowed_modules = None
                if args.modules:
                    allowed_modules = set(args.modules.split(","))
                
                detections = []
                
                start_p = sii_host_entry["page"]
                end_p = sii_host_entry["end_page"]
                host_title_lower = sii_host_entry["title"].lower()
                
                for p in range(start_p, end_p + 1):
                    text = extract_text_with_error_handling(pdf, p, manifest)
                    lines = text.split('\n')
                    
                    non_empty_lines = [(i, l) for i, l in enumerate(lines) if l.strip()]
                    if not non_empty_lines:
                        continue
                        
                    top_third_limit = len(lines) // 3
                    top_third_non_empty = [i for i, l in non_empty_lines if i <= top_third_limit]
                    
                    for i, line in enumerate(lines):
                        stripped = line.strip()
                        if not stripped:
                            continue
                            
                        # Ignore exact matches of the chapter title (often used as page headers)
                        if stripped.lower() == host_title_lower:
                            continue
                            
                        # Check target table
                        matched_mod = None
                        for mod_id, terms in target_table:
                            if allowed_modules and mod_id not in allowed_modules:
                                continue
                            if any(term in stripped.lower() for term in terms):
                                matched_mod = mod_id
                                break
                                
                        if not matched_mod:
                            continue
                            
                        if len(stripped) >= 120:
                            continue
                            
                        is_all_caps = stripped.isupper()
                        is_title = is_title_case(stripped)
                        
                        prev_line_short_or_blank = False
                        if i == 0:
                            prev_line_short_or_blank = True
                        else:
                            prev_stripped = lines[i-1].strip()
                            if not prev_stripped or len(prev_stripped) < 5:
                                prev_line_short_or_blank = True
                                
                        only_in_top_third = False
                        if i <= top_third_limit and len(top_third_non_empty) == 1 and top_third_non_empty[0] == i:
                            only_in_top_third = True
                            
                        if (is_all_caps or is_title) or prev_line_short_or_blank or only_in_top_third:
                            detections.append({
                                "module_id": matched_mod,
                                "heading_text": stripped,
                                "page": p,
                                "line_index": i
                            })
                
                # Sort detections
                detections.sort(key=lambda x: (x["page"], x["line_index"]))
                
                # Filter overlapping detections and deduplicate modules
                filtered_detections = []
                seen_modules = set()
                for d in detections:
                    if d["module_id"] in seen_modules:
                        continue
                        
                    conflict = False
                    for fd in filtered_detections:
                        if d["page"] == fd["page"] and abs(d["line_index"] - fd["line_index"]) <= 5:
                            if d["module_id"] != fd["module_id"]:
                                manifest["boundary_conflicts"].append({
                                    "kept": fd["module_id"],
                                    "discarded": d["module_id"],
                                    "page": d["page"]
                                })
                            conflict = True
                            break
                    if not conflict:
                        filtered_detections.append(d)
                        seen_modules.add(d["module_id"])
                
                # Extract content for each detection
                combined_tier2_text = []
                
                for idx, d in enumerate(filtered_detections):
                    mod_id = d["module_id"]
                    start_page = d["page"]
                    start_line = d["line_index"] + 1
                    
                    if idx + 1 < len(filtered_detections):
                        end_page = filtered_detections[idx+1]["page"]
                        end_line = filtered_detections[idx+1]["line_index"]
                    else:
                        end_page = end_p
                        end_line = -1
                        
                    page_blocks = []
                    full_text_parts = []
                    
                    for p in range(start_page, end_page + 1):
                        text = extract_text_with_error_handling(pdf, p, manifest)
                        lines = text.split('\n')
                        
                        s_idx = start_line if p == start_page else 0
                        e_idx = end_line if p == end_page and end_line != -1 else len(lines)
                        
                        chunk_lines = lines[s_idx:e_idx]
                        chunk_text = "\n".join(chunk_lines).strip()
                        
                        if chunk_text:
                            page_blocks.append({"page": p, "text": chunk_text})
                            full_text_parts.append(f"[Page {p}]\n{chunk_text}")
                            
                    full_text = "\n".join(full_text_parts)
                    
                    manifest["tier2_modules"].append(mod_id)
                    manifest["module_index"][mod_id] = {
                        "tier": 2,
                        "start_page": start_page,
                        "end_page": end_page,
                        "char_count": len(full_text)
                    }
                    
                    out_data = {
                        "module_id": mod_id,
                        "tier": 2,
                        "source_chapter": sii_mod_id,
                        "heading_text": d["heading_text"],
                        "start_page": start_page,
                        "end_page": end_page,
                        "char_count": len(full_text),
                        "page_blocks": page_blocks,
                        "text": full_text
                    }
                    write_json(tier2_dir / f"{mod_id}.json", out_data)
                    
                    combined_tier2_text.append(f"[MODULE: {mod_id}]\n{full_text}")
                
                manifest["combined_text_tier2"] = "\n\n".join(combined_tier2_text)
                
                # Check missing
                found_mods = set(d["module_id"] for d in filtered_detections)
                for mod_id, _ in target_table:
                    if allowed_modules and mod_id not in allowed_modules:
                        continue
                    if mod_id not in found_mods:
                        manifest["tier2_modules_not_found"].append(mod_id)

    # Stage 3: Build manifest
    write_json(output_dir / "manifest.json", manifest)
    
    # Final stdout summary
    print("=" * 60)
    print(f"Extraction complete for: {manifest['prospectus_file']}")
    print("=" * 60)
    print(f"TOC parsed:        {manifest['toc_entry_count']} chapters found")
    if manifest['sii_host_chapter']:
        sii_host = manifest['sii_host_chapter']
        sii_info = manifest['module_index'].get(sii_host, {})
        s_p = sii_info.get('start_page', '?')
        e_p = sii_info.get('end_page', '?')
        print(f"SII host chapter:  {sii_host} (pp. {s_p}-{e_p})")
    else:
        print("SII host chapter:  None")
    print()
    print(f"Tier 1 modules:    {len(manifest['tier1_modules'])} saved, {len(manifest['tier1_modules_skipped'])} skipped")
    print(f"Tier 2 modules:    {len(manifest['tier2_modules'])} found, {len(manifest['tier2_modules_not_found'])} not found")
    if manifest['tier2_modules']:
        print(f"  Found:     {', '.join(manifest['tier2_modules'])}")
    if manifest['tier2_modules_not_found']:
        print(f"  Not found: {', '.join(manifest['tier2_modules_not_found'])}")
    print()
    
    total_chars = sum(m['char_count'] for m in manifest['module_index'].values())
    
    # Calculate unique pages extracted
    extracted_pages = set()
    for m in manifest['module_index'].values():
        extracted_pages.update(range(m['start_page'], m['end_page'] + 1))
        
    print(f"Total text extracted: ~{total_chars:,} characters across {len(extracted_pages)} pages")
    print(f"Output directory:  {args.output_dir}")
    print("=" * 60)

if __name__ == "__main__":
    main()