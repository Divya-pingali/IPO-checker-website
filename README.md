# Linklaters IPO Checker Website

A web application for checking and analyzing IPO-related findings and rulebook references. Built with React, TypeScript, and Vite.

## Features

- **PDF Viewer**: Interactive PDF viewing with text highlighting capabilities
- **Finding Cards**: Organized display of audit findings with detailed information
- **Filtering System**: Filter findings by various criteria
- **Rulebook Panel**: Reference rulebook sections alongside findings
- **Responsive Layout**: Resizable panels for flexible workspace management

## Technology Stack

- **React** - UI framework
- **TypeScript** - Type-safe JavaScript
- **Vite** - Lightning-fast build tool
- **CSS** - Styling

## Project Structure

```
src/
├── components/       # React components
│   ├── AppShell.tsx
│   ├── FilterBar.tsx
│   ├── FindingCard.tsx
│   ├── HighlightLayer.tsx
│   ├── ModuleSection.tsx
│   ├── PageRenderer.tsx
│   ├── PdfViewer.tsx
│   ├── RulebookPanel.tsx
│   └── Sidebar.tsx
├── hooks/           # Custom React hooks
│   ├── useFindingsParser.ts
│   ├── usePdfAnchorMatcher.ts
│   ├── usePdfDocument.ts
│   ├── useResizablePanels.ts
│   └── useRulebookReference.ts
├── utils/          # Utility functions
│   ├── normalizeFindings.ts
│   └── textMatcher.ts
├── types/          # TypeScript type definitions
├── App.tsx         # Main app component
├── main.tsx        # Entry point
└── index.css       # Global styles
```

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Development

Run the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### Build

Create a production build:
```bash
npm run build
```

### Preview

Preview the production build locally:
```bash
npm run preview
```

## Configuration

- `vite.config.ts` - Vite configuration
- `tsconfig.json` - TypeScript configuration
- `package.json` - Project dependencies and scripts

## Data Files

- `public/checker.json` - Rulebook data
- `BST_checker_output_v3.json` - Findings data

---

## Backend Pipeline — Extract & Analyse

The pipeline converts a prospectus PDF (or DOCX) into the `checker.json` consumed by the website.

### Prerequisites

```bash
# 1. Section extraction (pdfplumber)
pip install -r section_extraction/requirements.txt

# 2. Claude API analysis (anthropic SDK)
pip install -r pipeline/requirements.txt

# 3. Set your Anthropic API key
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Full pipeline (one command)

Run from inside `llaw3272-linklaters-ipo-checker-website/`:

```bash
python pipeline/run_pipeline.py path/to/prospectus.pdf
```

This will:
1. Extract sections from the prospectus into `./extracted/tier1/` and `./extracted/tier2/`
2. Send them to the Claude API using `public/rulebook_prompt_v3.md` as the system prompt
3. Save the resulting analysis as `public/checker.json`

Then start the viewer:

```bash
npm run dev
```

### Options

```
python pipeline/run_pipeline.py <prospectus.pdf> [options]

  --extraction-dir DIR    Where to write extracted sections (default: ./extracted)
  --checker-output FILE   Output path for checker.json (default: public/checker.json)
  --prospectus-dest FILE  Also copy the PDF here so the viewer can load it
                          (e.g. --prospectus-dest public/prospectus.pdf)
  --model MODEL           Claude model ID (default: claude-opus-4-7)
  --api-key KEY           API key (or set ANTHROPIC_API_KEY env var)
  --skip-extraction       Reuse an existing ./extracted directory; skip step 1
  --toc-pages START-END   PDF pages to search for Table of Contents (default: 1-15)
  --verbose               Enable detailed logging
```

### Run steps separately

```bash
# Step 1: extract sections only
python section_extraction/extract_sections.py prospectus.pdf --output-dir ./extracted

# Step 2: analyse only (sections already extracted)
python pipeline/analyze.py --extraction-dir ./extracted
```

### How it works

```
prospectus.pdf
  └─► extract_sections.py
        ├─ extracted/tier1/<chapter>.json   (full chapters: cap_table, directors_mgmt, …)
        └─ extracted/tier2/<section>.json   (SII subsections: sii_disclosure, pathfinder_sii, …)
              └─► analyze.py
                    ├─ system prompt: public/rulebook_prompt_v3.md
                    ├─ user message : formatted tier1 + tier2 JSON blocks
                    └─► Claude API (claude-opus-4-7)
                          └─► public/checker.json   ← consumed by the React viewer
```

**Prompt caching** is enabled on the system prompt to reduce API cost on repeated runs against the same rulebook version.

**Label mapping** — `extract_sections.py` names certain subsections differently from the prompt's expected file paths. `analyze.py` remaps them automatically (e.g. `corporate_structure_chart` → `tier2/corporate_structure`). Tier-1 modules are matched by keyword (e.g. any module whose ID contains `substantial_shareholders` becomes `tier1/cap_table`).

### Adapting for a different rulebook or prompt

- Replace `public/rulebook_prompt_v3.md` with your new prompt file, or pass `--prompt path/to/new_prompt.md` to `analyze.py`.
- The section label mappings are defined at the top of `pipeline/analyze.py` (`TIER2_LABEL_MAP`, `TIER1_PATTERN_MAP`) and can be extended for other document types.
- To use a less expensive model for testing: `--model claude-haiku-4-5-20251001`.

---

## License

Copyright © Linklaters
