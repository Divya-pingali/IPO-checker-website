#!/usr/bin/env python3
"""
LLAW Meaningful Investment Checker — Full Pipeline Runner

Runs the complete end-to-end pipeline in two steps:
  1. extract_sections.py  — extracts prospectus sections into tier1/ + tier2/ JSON files
  2. analyze.py           — sends sections to Claude API and saves checker.json

Usage:
    python pipeline/run_pipeline.py path/to/prospectus.pdf [options]

    # Skip extraction if sections already extracted:
    python pipeline/run_pipeline.py path/to/prospectus.pdf --skip-extraction

    # Use a different model:
    python pipeline/run_pipeline.py path/to/prospectus.pdf --model claude-sonnet-4-6

Environment:
    ANTHROPIC_API_KEY  Required for the analysis step.
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def _run(cmd: list[str], step: str) -> None:
    """Run a subprocess command, exiting on failure."""
    print(f"\n[{step}] Running: {' '.join(str(c) for c in cmd)}\n{'─'*60}")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        print(f"\n[ERROR] {step} failed (exit code {result.returncode})", file=sys.stderr)
        sys.exit(result.returncode)


def main(argv: list[str] | None = None) -> int:
    script_dir = Path(__file__).parent
    project_dir = script_dir.parent

    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "input_file",
        help="Path to the prospectus PDF or DOCX file",
    )
    parser.add_argument(
        "--extraction-dir", "-d",
        default="./extracted",
        metavar="DIR",
        help="Directory for extracted section files (default: ./extracted)",
    )
    parser.add_argument(
        "--checker-output", "-o",
        default=str(project_dir / "public" / "checker.json"),
        metavar="FILE",
        help="Output path for checker.json served by the website "
             "(default: public/checker.json)",
    )
    parser.add_argument(
        "--prospectus-dest",
        metavar="FILE",
        help="Also copy the prospectus to this path so the website viewer can "
             "load it (e.g. public/prospectus.pdf). Skipped if not provided.",
    )
    parser.add_argument(
        "--model", "-m",
        default="claude-opus-4-7",
        help="Claude model to use for analysis (default: claude-opus-4-7)",
    )
    parser.add_argument(
        "--api-key",
        help="Anthropic API key (default: ANTHROPIC_API_KEY env var)",
    )
    parser.add_argument(
        "--skip-extraction",
        action="store_true",
        help="Skip extraction and use an existing --extraction-dir",
    )
    parser.add_argument(
        "--toc-pages",
        default="1-15",
        metavar="START-END",
        help="PDF page range to search for Table of Contents (default: 1-15)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Pass --verbose to both sub-scripts",
    )
    args = parser.parse_args(argv)

    input_file = Path(args.input_file)
    if not input_file.exists():
        print(f"[ERROR] Input file not found: {input_file}", file=sys.stderr)
        return 1

    print(
        f"\n{'='*60}\n"
        f"  LLAW Meaningful Investment Checker — Pipeline\n"
        f"{'='*60}\n"
        f"  Input    : {input_file}\n"
        f"  Extracted: {args.extraction_dir}\n"
        f"  Output   : {args.checker_output}\n"
        f"  Model    : {args.model}\n"
        f"{'='*60}"
    )

    # ── Step 1: Section extraction ────────────────────────────────────────────
    if not args.skip_extraction:
        extract_script = project_dir / "section_extraction" / "extract_sections.py"
        if not extract_script.exists():
            print(f"[ERROR] extract_sections.py not found at {extract_script}", file=sys.stderr)
            return 1

        cmd = [
            sys.executable, str(extract_script),
            str(input_file),
            "--output-dir", args.extraction_dir,
            "--toc-pages", args.toc_pages,
        ]
        if args.verbose:
            cmd.append("--verbose")

        _run(cmd, "STEP 1/2 — Extraction")
    else:
        print(f"\n[STEP 1/2 — Extraction] Skipped. Using existing: {args.extraction_dir}")

    # ── Optional: copy prospectus to website public/ ─────────────────────────
    if args.prospectus_dest:
        dest = Path(args.prospectus_dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(input_file, dest)
        print(f"\nProspectus copied → {dest}")

    # ── Step 2: Claude API analysis ───────────────────────────────────────────
    analyze_script = script_dir / "analyze.py"
    prompt_path = project_dir / "public" / "rulebook_prompt_v3.md"

    cmd = [
        sys.executable, str(analyze_script),
        "--extraction-dir", args.extraction_dir,
        "--prompt", str(prompt_path),
        "--output", args.checker_output,
        "--model", args.model,
    ]
    if args.api_key:
        cmd += ["--api-key", args.api_key]
    if args.verbose:
        cmd.append("--verbose")

    _run(cmd, "STEP 2/2 — Analysis")

    print(
        f"\n{'='*60}\n"
        f"  Pipeline complete!\n"
        f"  checker.json → {args.checker_output}\n"
        f"\n"
        f"  Start the website viewer:\n"
        f"    cd {project_dir.name}\n"
        f"    npm run dev\n"
        f"{'='*60}\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
