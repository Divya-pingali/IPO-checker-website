#!/usr/bin/env python3
"""
LLAW Meaningful Investment Checker — API Server

Accepts a prospectus upload, runs extraction + Gemini analysis, returns checker.json.

Usage:
    # From inside llaw3272-linklaters-ipo-checker-website/
    python backend/server.py

    # With hot-reload for development:
    uvicorn backend.server:app --reload --port 8000

Environment:
    GEMINI_API_KEY  Set in .env at the project root (auto-loaded).
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
from fastapi.responses import FileResponse

try:
    from backend.output_saver import save_outputs
except ImportError:
    from output_saver import save_outputs  # when run as python backend/server.py

_BACKEND_DIR  = Path(__file__).parent
_PROJECT_DIR  = _BACKEND_DIR.parent
_OUTPUT_DIR   = _PROJECT_DIR / "Output"

load_dotenv(_PROJECT_DIR / ".env")

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

# In-memory job store  {job_id: {status, stage, message, result}}
jobs: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Background pipeline
# ---------------------------------------------------------------------------

def _set(job_id: str, **kwargs: object) -> None:
    if job_id in jobs:
        jobs[job_id].update(kwargs)


async def _run_subprocess(args: list[str]) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    return proc.returncode, out.decode(errors="replace"), err.decode(errors="replace")


async def run_pipeline(job_id: str, input_file: Path, temp_dir: Path) -> None:
    extraction_dir = temp_dir / "extracted"
    output_json    = temp_dir / "checker.json"

    extract_script  = _BACKEND_DIR / "extract_sections.py"
    analyze_script  = _BACKEND_DIR / "analyze.py"
    prompt_path     = _PROJECT_DIR / "reference" / "rulebook_prompt_v4.md"

    api_key = os.environ.get("GEMINI_API_KEY", "")

    try:
        pdf_path = input_file

        # DOCX → PDF
        if input_file.suffix.lower() == ".docx":
            _set(job_id, stage="converting", message="Converting Word document to PDF…")
            log.info("[%s] Converting DOCX", job_id)
            if shutil.which("libreoffice") is None:
                raise RuntimeError(
                    "LibreOffice is required for .docx conversion. "
                    "Install it or upload a PDF instead."
                )
            rc, _, stderr = await _run_subprocess([
                "libreoffice", "--headless", "--convert-to", "pdf",
                "--outdir", str(temp_dir), str(input_file),
            ])
            if rc != 0:
                raise RuntimeError(f"LibreOffice failed: {stderr}")
            pdf_path = temp_dir / (input_file.stem + ".pdf")
            if not pdf_path.exists():
                raise RuntimeError(f"Converted PDF not found at {pdf_path}")

        # Step 1: extraction
        _set(job_id, stage="extracting", message="Extracting sections from prospectus…")
        log.info("[%s] Extracting", job_id)
        rc, stdout, stderr = await _run_subprocess([
            sys.executable, str(extract_script),
            str(pdf_path), "--output-dir", str(extraction_dir),
        ])
        if rc != 0:
            raise RuntimeError(f"Extraction failed (exit {rc}).\n{stderr or stdout}")
        log.info("[%s] Extraction done", job_id)

        # Step 2: analysis
        _set(job_id, stage="analysing",
             message="Analysing with Gemini API — this may take a few minutes…")
        log.info("[%s] Analysing", job_id)
        cmd = [
            sys.executable, str(analyze_script),
            "--extraction-dir", str(extraction_dir),
            "--prompt",  str(prompt_path),
            "--output",  str(output_json),
        ]
        if api_key:
            cmd += ["--api-key", api_key]
        rc, stdout, stderr = await _run_subprocess(cmd)
        if rc != 0:
            raise RuntimeError(f"Analysis failed (exit {rc}).\n{stderr or stdout}")
        log.info("[%s] Analysis done", job_id)

        if not output_json.exists():
            raise RuntimeError("checker.json not produced by analyze.py")

        result = json.loads(output_json.read_text(encoding="utf-8"))

        # Persist outputs to Output/ folder (PDF + JSON + Word doc)
        try:
            saved = save_outputs(pdf_path, result)
            log.info("[%s] Saved outputs → %s", job_id,
                     {k: str(v) for k, v in saved.items()})
        except Exception as save_exc:
            log.warning("[%s] Could not save outputs: %s", job_id, save_exc)

        _set(job_id, status="complete", stage="complete",
             message="Analysis complete!", result=result)
        log.info("[%s] Job complete", job_id)

    except Exception as exc:
        log.error("[%s] Pipeline error: %s", job_id, exc)
        _set(job_id, status="error", stage="error", message=str(exc))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/api/analyse")
async def start_analysis(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".pdf", ".docx"):
        raise HTTPException(422, "Only PDF or Word (.docx) files are supported.")
    if not os.environ.get("GEMINI_API_KEY"):
        raise HTTPException(500, "GEMINI_API_KEY is not set. Add it to .env.")

    temp_dir   = Path(tempfile.mkdtemp(prefix="llaw_"))
    input_file = temp_dir / f"prospectus{suffix}"
    contents   = await file.read()
    input_file.write_bytes(contents)
    log.info("Received %s (%d bytes)", file.filename, len(contents))

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "running", "stage": "pending",
        "message": "Pipeline started…", "result": None,
    }
    background_tasks.add_task(run_pipeline, job_id, input_file, temp_dir)
    return {"job_id": job_id}


@app.get("/api/status/{job_id}")
async def get_status(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"Job {job_id!r} not found.")
    return {
        "job_id":     job_id,
        "status":     job["status"],
        "stage":      job["stage"],
        "message":    job["message"],
        "has_result": job["result"] is not None,
    }


@app.get("/api/result/{job_id}")
async def get_result(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"Job {job_id!r} not found.")
    if job["status"] != "complete":
        raise HTTPException(409, f"Job not complete yet (status: {job['status']}).")
    return job["result"]


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "api_key_set": bool(os.environ.get("GEMINI_API_KEY"))}


@app.get("/api/history")
async def list_history() -> list[dict]:
    """Return metadata for all saved analyses in the Output/ folder."""
    results = []
    if not _OUTPUT_DIR.exists():
        return results
    for json_file in sorted(_OUTPUT_DIR.glob("output*.json")):
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            meta = data.get("meta", {})
            results.append({
                "name": json_file.stem,
                "company_name": meta.get("company_name", "Unknown"),
                "analysis_date": meta.get("analysis_date", ""),
                "rulebook_version": meta.get("rulebook_version", ""),
                "has_pdf": (_OUTPUT_DIR / (json_file.stem + ".pdf")).exists(),
            })
        except Exception:
            pass
    return results


@app.get("/api/history/{name}")
async def get_history_item(name: str) -> dict:
    """Return a specific saved analysis JSON."""
    json_file = _OUTPUT_DIR / f"{name}.json"
    if not json_file.exists():
        raise HTTPException(404, f"Analysis {name!r} not found.")
    return json.loads(json_file.read_text(encoding="utf-8"))


@app.get("/api/history/{name}/pdf")
async def get_history_pdf(name: str) -> FileResponse:
    """Stream the PDF for a saved analysis."""
    pdf_file = _OUTPUT_DIR / f"{name}.pdf"
    if not pdf_file.exists():
        raise HTTPException(404, f"PDF for {name!r} not found.")
    return FileResponse(pdf_file, media_type="application/pdf")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    log.info("Starting on http://localhost:%d", port)
    uvicorn.run("backend.server:app", host="0.0.0.0", port=port, reload=False)
