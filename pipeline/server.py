#!/usr/bin/env python3
"""
LLAW Meaningful Investment Checker — API Server

Accepts a prospectus file upload, runs the two-stage pipeline
(extraction → Claude analysis), and returns checker.json to the React viewer.

Usage:
    # From inside llaw3272-linklaters-ipo-checker-website/
    python pipeline/server.py

    # Or with uvicorn directly (supports --reload for development):
    uvicorn pipeline.server:app --reload --port 8000

Environment:
    ANTHROPIC_API_KEY   Set in a .env file at the project root (recommended)
                        or as a shell environment variable.

Install dependencies:
    pip install -r pipeline/requirements.txt
"""

import asyncio
import json
import logging
import os
import shutil
import sys
import tempfile
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

# Load .env from the project root (parent of pipeline/)
load_dotenv(Path(__file__).parent.parent / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger(__name__)

app = FastAPI(title="LLAW IPO Checker API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent

# In-memory job store  {job_id: job_dict}
# job_dict keys: status, stage, message, result, error
jobs: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Background pipeline task
# ---------------------------------------------------------------------------

def _set(job_id: str, **kwargs: object) -> None:
    if job_id in jobs:
        jobs[job_id].update(kwargs)


async def _run_subprocess(args: list[str]) -> tuple[int, str, str]:
    """Run a subprocess and return (returncode, stdout, stderr)."""
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout_b, stderr_b = await proc.communicate()
    return (
        proc.returncode,
        stdout_b.decode(errors="replace"),
        stderr_b.decode(errors="replace"),
    )


async def run_pipeline(job_id: str, input_file: Path, temp_dir: Path) -> None:
    """Full extraction + analysis pipeline as an async background task."""
    extraction_dir = temp_dir / "extracted"
    output_json = temp_dir / "checker.json"
    extract_script = PROJECT_DIR / "section_extraction" / "extract_sections.py"
    analyze_script = SCRIPT_DIR / "analyze.py"
    prompt_path = PROJECT_DIR / "public" / "rulebook_prompt_v3.md"
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")

    try:
        pdf_path = input_file

        # ── DOCX conversion ───────────────────────────────────────────────────
        if input_file.suffix.lower() == ".docx":
            _set(job_id, stage="converting",
                 message="Converting Word document to PDF…")
            log.info("[%s] Converting DOCX to PDF", job_id)

            if shutil.which("libreoffice") is None:
                raise RuntimeError(
                    "LibreOffice is required to convert .docx files but was not "
                    "found on PATH. Install it or upload a PDF instead."
                )

            rc, _, stderr = await _run_subprocess([
                "libreoffice", "--headless", "--convert-to", "pdf",
                "--outdir", str(temp_dir), str(input_file),
            ])
            if rc != 0:
                raise RuntimeError(f"LibreOffice conversion failed: {stderr}")

            pdf_path = temp_dir / (input_file.stem + ".pdf")
            if not pdf_path.exists():
                raise RuntimeError(f"Converted PDF not found at {pdf_path}")

        # ── Step 1: section extraction ────────────────────────────────────────
        _set(job_id, stage="extracting",
             message="Extracting sections from prospectus…")
        log.info("[%s] Running extract_sections.py", job_id)

        rc, stdout, stderr = await _run_subprocess([
            sys.executable, str(extract_script),
            str(pdf_path),
            "--output-dir", str(extraction_dir),
        ])
        if rc != 0:
            raise RuntimeError(
                f"Section extraction failed (exit {rc}).\n{stderr or stdout}"
            )
        log.info("[%s] Extraction complete", job_id)

        # ── Step 2: Claude analysis ───────────────────────────────────────────
        _set(job_id, stage="analysing",
             message="Analysing with Claude API — this may take a few minutes…")
        log.info("[%s] Running analyze.py", job_id)

        cmd = [
            sys.executable, str(analyze_script),
            "--extraction-dir", str(extraction_dir),
            "--prompt", str(prompt_path),
            "--output", str(output_json),
        ]
        if api_key:
            cmd += ["--api-key", api_key]

        rc, stdout, stderr = await _run_subprocess(cmd)
        if rc != 0:
            raise RuntimeError(
                f"Analysis failed (exit {rc}).\n{stderr or stdout}"
            )
        log.info("[%s] Analysis complete", job_id)

        # ── Read result ───────────────────────────────────────────────────────
        if not output_json.exists():
            raise RuntimeError("checker.json was not produced by analyze.py")

        result = json.loads(output_json.read_text(encoding="utf-8"))
        _set(job_id, status="complete", stage="complete",
             message="Analysis complete!", result=result)
        log.info("[%s] Job complete", job_id)

    except Exception as exc:
        log.error("[%s] Pipeline error: %s", job_id, exc)
        _set(job_id, status="error", stage="error", message=str(exc))

    finally:
        # Always clean up temp files
        shutil.rmtree(temp_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.post("/api/analyse")
async def start_analysis(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
) -> dict:
    """
    Accept a prospectus PDF or DOCX, start the extraction + analysis pipeline,
    and return a job_id for polling /api/status/{job_id}.
    """
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".pdf", ".docx"):
        raise HTTPException(
            status_code=422,
            detail="Only PDF (.pdf) and Word (.docx) files are supported.",
        )

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY is not set on the server. "
                   "Set it before starting the server.",
        )

    # Save upload to a per-job temp directory
    temp_dir = Path(tempfile.mkdtemp(prefix="llaw_"))
    input_file = temp_dir / f"prospectus{suffix}"
    contents = await file.read()
    input_file.write_bytes(contents)
    log.info("Received %s (%d bytes), saved to %s", file.filename, len(contents), input_file)

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "running",
        "stage": "pending",
        "message": "Pipeline started…",
        "result": None,
        "error": None,
    }

    background_tasks.add_task(run_pipeline, job_id, input_file, temp_dir)
    return {"job_id": job_id}


@app.get("/api/status/{job_id}")
async def get_status(job_id: str) -> dict:
    """Poll this endpoint to check pipeline progress."""
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found.")
    # Return a copy without the full result to keep polling responses small
    return {
        "job_id": job_id,
        "status": job["status"],
        "stage": job["stage"],
        "message": job["message"],
        "has_result": job["result"] is not None,
    }


@app.get("/api/result/{job_id}")
async def get_result(job_id: str) -> dict:
    """Fetch the full checker.json result once the job is complete."""
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found.")
    if job["status"] != "complete":
        raise HTTPException(
            status_code=409,
            detail=f"Job is not complete yet (status: {job['status']}).",
        )
    return job["result"]


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "api_key_set": bool(os.environ.get("ANTHROPIC_API_KEY"))}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    log.info("Starting LLAW IPO Checker API on http://localhost:%d", port)
    log.info("API key configured: %s", bool(os.environ.get("ANTHROPIC_API_KEY")))
    uvicorn.run("pipeline.server:app", host="0.0.0.0", port=port, reload=False)
