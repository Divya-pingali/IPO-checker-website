#!/usr/bin/env python3
"""
LLAW Meaningful Investment Checker — Full Pipeline Runner

Runs the end-to-end pipeline from the command line:
  1. extract_sections.py  → tier1/ + tier2/ JSON files
  2. analyze.py           → checker.json

Usage:
    python backend/run_pipeline.py path/to/prospectus.pdf

    # Skip extraction (reuse existing extracted/ dir):
    python backend/run_pipeline.py path/to/prospectus.pdf --skip-extraction

Environment:
    GEMINI_API_KEY  Set in .env at the project root (auto-loaded).
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).parent
_PROJECT_DIR = _BACKEND_DIR.parent

load_dotenv(_PROJECT_DIR / ".env")


def _run(cmd: list[str], step: str) -> None:
    print(f"\n[{step}] {' '.join(str(c) for c in cmd)}\n{'─'*60}")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        print(f"\n[ERROR] {step} failed (exit {result.returncode})", file=sys.stderr)
        sys.exit(result.returncode)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("input_file", help="Prospectus PDF or DOCX")
    parser.add_argument("--extraction-dir", "-d", default="./extracted",
                        help="Directory for extracted sections (default: ./extracted)")
    parser.add_argument("--output", "-o",
                        default=str(_PROJECT_DIR / "public" / "checker.json"),
                        help="Output checker.json path (default: public/checker.json)")
    parser.add_argument("--prospectus-dest",
                        help="Also copy prospectus here for the viewer (e.g. public/prospectus.pdf)")
    parser.add_argument("--model", "-m", default="gemini-2.5-pro")
    parser.add_argument("--api-key", help="Override GEMINI_API_KEY")
    parser.add_argument("--skip-extraction", action="store_true")
    parser.add_argument("--toc-pages", default="1-15", metavar="START-END")
    parser.add_argument(
        "--thinking-budget",
        type=int,
        default=0,
        help="Optional Gemini thinking budget forwarded to analyze.py",
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    input_file = Path(args.input_file)
    if not input_file.exists():
        print(f"[ERROR] File not found: {input_file}", file=sys.stderr)
        return 1

    print(
        f"\n{'='*60}\n"
        f"  LLAW Meaningful Investment Checker\n"
        f"{'='*60}\n"
        f"  Input     : {input_file}\n"
        f"  Extracted : {args.extraction_dir}\n"
        f"  Output    : {args.output}\n"
        f"  Model     : {args.model}\n"
        f"{'='*60}"
    )

    # Step 1: extraction
    if not args.skip_extraction:
        extract_script = _BACKEND_DIR / "extract_sections.py"
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
        print(f"\n[STEP 1/2] Skipped — using: {args.extraction_dir}")

    if args.prospectus_dest:
        dest = Path(args.prospectus_dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(input_file, dest)
        print(f"Copied prospectus → {dest}")

    # Step 2: analysis
    analyze_script = _BACKEND_DIR / "analyze.py"
    prompt_path    = _PROJECT_DIR / "reference" / "rulebook_prompt_v4.md"
    cmd = [
        sys.executable, str(analyze_script),
        "--extraction-dir", args.extraction_dir,
        "--prompt",   str(prompt_path),
        "--output",   args.output,
        "--model",    args.model,
    ]
    if args.api_key:
        cmd += ["--api-key", args.api_key]
    if args.thinking_budget > 0:
        cmd += ["--thinking-budget", str(args.thinking_budget)]
    if args.verbose:
        cmd.append("--verbose")
    _run(cmd, "STEP 2/2 — Analysis")

    print(
        f"\n{'='*60}\n"
        f"  Done! checker.json → {args.output}\n"
        f"  Start the viewer: npm run dev\n"
        f"{'='*60}\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
