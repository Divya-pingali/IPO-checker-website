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

## License

Copyright © Linklaters
