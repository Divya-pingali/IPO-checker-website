# Edith IPO Prospectus Checker

A web application that runs an end-to-end compliance analysis of HKEX Chapter 18C IPO prospectuses against the Meaningful Investment (SII) requirements, and displays the results in an interactive PDF viewer.

---

## Project Structure

```
llaw3272-edith-ipo-checker-website/
├── backend/                   Python pipeline
│   ├── extract_sections.py    Extracts tier1/tier2 sections from a prospectus PDF
│   ├── analyze.py             Sends sections to Claude API, produces checker.json
│   ├── server.py              FastAPI server (used by the web upload flow)
│   └── run_pipeline.py        CLI runner: extract → analyse in one command
│
├── reference/                 Backend reference materials (not served to the browser)
│   └── rulebook_prompt_v4.md  System prompt with all SII rules
│
├── public/                    Static assets served by Vite
│   ├── checker.json           Analysis output consumed by the viewer
│   ├── rulebook.pdf           Rulebook shown in the side panel
│   └── prospectus.pdf         Sample prospectus for the viewer
│
├── src/                       React + TypeScript frontend
│   ├── components/            UI components (viewer, sidebar, upload screen…)
│   ├── hooks/                 Custom hooks (PDF, findings parser, anchors…)
│   ├── utils/                 normalizeFindings, textMatcher
│   └── types/                 TypeScript schema matching checker.json
│
├── .env.example               Copy to .env and fill in your API key
├── requirements.txt           All Python dependencies
└── package.json               Frontend dependencies (npm)
```

---

## Setup

### 1. Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Frontend dependencies

```bash
npm install
```

### 3. API key

```bash
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

---

## Running the full web UI

Start both servers in separate terminals from inside this directory.

**Terminal 1 — Python backend:**
```bash
python -m backend.server
# Listening on http://localhost:8000
```

**Terminal 2 — Vite frontend:**
```bash
npm run dev
# Open http://localhost:5173
```

Open the browser, drop a prospectus PDF onto the upload screen, click **Analyse**, and watch the pipeline run. Results appear directly in the viewer when complete.

---

## CLI pipeline (no browser required)

```bash
# Full pipeline: extract + analyse → public/checker.json
python backend/run_pipeline.py path/to/prospectus.pdf

# Also copy the prospectus so the viewer can load it:
python backend/run_pipeline.py path/to/prospectus.pdf \
  --prospectus-dest public/prospectus.pdf

# Skip extraction (reuse a previous ./extracted run):
python backend/run_pipeline.py path/to/prospectus.pdf --skip-extraction

# Options
#   --extraction-dir DIR    Where to write extracted sections (default: ./extracted)
#   --output FILE           checker.json output path (default: public/checker.json)
#   --model MODEL           Claude model (default: claude-opus-4-7)
#   --toc-pages START-END   PDF pages to scan for Table of Contents (default: 1-15)
#   --verbose               Detailed logging
```

---

## How it works

```
prospectus.pdf
  └─► backend/extract_sections.py
        ├─ extracted/tier1/<chapter>.json    full chapters (cap table, directors…)
        └─ extracted/tier2/<section>.json    SII subsections (sii_disclosure, pathfinder_sii…)
              └─► backend/analyze.py
                    ├─ system prompt : reference/rulebook_prompt_v4.md
                    ├─ rulebook PDF  : public/rulebook.pdf  (cached per API call)
                    └─► Claude API (module-by-module, with retry + rate-limit handling)
                          └─► public/checker.json  ← loaded by the React viewer
```

**Prompt caching:** the system prompt and rulebook PDF are sent with `cache_control: ephemeral`, so repeated runs against the same rulebook version cost significantly less.

**Module-by-module calls:** each of the 10 modules (0, A–I) is analysed in a separate API call to stay within output token limits and allow targeted retries.

---

## Adapting for a different rulebook or prompt

- Replace `reference/rulebook_prompt_v4.md` with your new prompt, or pass `--prompt path/to/prompt.md`.
- Section label mappings are in `backend/analyze.py` (`TIER2_LABEL_MAP`, `TIER1_PATTERN_MAP`).
- To use a cheaper model for testing: `--model claude-haiku-4-5-20251001`.

---

## License

Copyright © Edith
