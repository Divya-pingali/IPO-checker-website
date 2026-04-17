import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Finding, FilterState, ViewMode, AssetConfig } from './types';
import { useFindingsParser } from './hooks/useFindingsParser';
import { usePdfDocument } from './hooks/usePdfDocument';
import { usePdfAnchorMatcher } from './hooks/usePdfAnchorMatcher';
import { useRulebookReference } from './hooks/useRulebookReference';
import { useResizablePanels } from './hooks/useResizablePanels';
import { AppShell } from './components/AppShell';
import { PdfViewer } from './components/PdfViewer';
import { Sidebar } from './components/Sidebar';
import { RulebookPanel } from './components/RulebookPanel';

// ─── Asset configuration ──────────────────────────────────────────────────────
const DEFAULT_ASSETS: AssetConfig = {
  prospectusUrl: '/prospectus.pdf',
  checkerJsonUrl: '/checker.json',
  rulebookUrl: '/rulebook.pdf',
  label: 'Black Sesame Technologies',
};

export default function App() {
  const assets = DEFAULT_ASSETS;

  // ── Data loading ─────────────────────────────────────────────────────────────
  const { findings, meta, loading: jsonLoading, error: jsonError } =
    useFindingsParser(assets.checkerJsonUrl);

  const { pdfDoc, numPages, loading: pdfLoading, error: pdfError } =
    usePdfDocument(assets.prospectusUrl);

  const { matchResults, extractionProgress, selectCandidate } =
    usePdfAnchorMatcher(pdfDoc, findings);

  const { rulebookUrl, rulebookOpen, openRulebook, closeRulebook, rulebookPage } =
    useRulebookReference(assets.rulebookUrl);

  // ── Panel resize ─────────────────────────────────────────────────────────────
  const { sidebarWidth, isDragging, handleMouseDown } = useResizablePanels({
    defaultSidebarWidth: 420,
    minSidebarWidth: 280,
    maxSidebarWidth: 720,
  });

  // ── Highlight lookup maps ─────────────────────────────────────────────────────
  const severityMap = useMemo(
    () => new Map(findings.map((f) => [f.id, f.severity])),
    [findings],
  );
  const statusMap = useMemo(
    () => new Map(findings.map((f) => [f.id, f.status])),
    [findings],
  );

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.4);
  const [scrollToPage, setScrollToPage] = useState<number | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    tab: 'rules',
    severity: [],
    status: [],
    moduleId: [],
    checkType: [],
    category: [],
    search: '',
  });
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');

  // Clear scrollToPage after use
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (scrollToPage !== null) {
      scrollTimerRef.current = setTimeout(() => setScrollToPage(null), 400);
    }
    return () => clearTimeout(scrollTimerRef.current);
  }, [scrollToPage]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleFindingClick = useCallback(
    (finding: Finding) => {
      setActiveFindingId((prev) => (prev === finding.id ? null : finding.id));
      const result = matchResults.get(finding.id);
      const candidate = result?.candidates[result.selectedCandidateIndex] ?? null;
      const targetPage = candidate?.page ?? finding.page;
      if (targetPage) {
        setScrollToPage(targetPage);
        setCurrentPage(targetPage);
        // After the page scrolls into view and highlights render, scroll to
        // the sentence-level highlight box for this finding.
        window.setTimeout(() => {
          const el = document.querySelector<HTMLElement>(
            `[data-highlight-id="${finding.id}"]`,
          );
          el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }, 400);
      }
    },
    [matchResults],
  );

  const handleHighlightClick = useCallback((findingId: string) => {
    setActiveFindingId((prev) => (prev === findingId ? null : findingId));
    setTimeout(() => {
      document
        .querySelector(`[data-finding-id="${findingId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────
  if (jsonError) {
    return (
      <div className="app-error">
        <strong>Failed to load checker JSON:</strong> {jsonError}
      </div>
    );
  }

  return (
    <AppShell
      meta={meta}
      pdfLoading={pdfLoading}
      jsonLoading={jsonLoading}
      extractionProgress={extractionProgress}
    >
      {/* Prevent text selection while dragging */}
      <div
        className="app-panels"
        style={{ userSelect: isDragging ? 'none' : undefined }}
      >
        {/* Left: PDF viewer */}
        <PdfViewer
          pdfDoc={pdfDoc}
          numPages={numPages}
          loadingPdf={pdfLoading}
          pdfError={pdfError}
          scale={scale}
          currentPage={currentPage}
          matchResults={matchResults}
          activeFindingId={activeFindingId}
          onHighlightClick={handleHighlightClick}
          onPageChange={setCurrentPage}
          onScaleChange={setScale}
          scrollToPage={scrollToPage}
          severityMap={severityMap}
          statusMap={statusMap}
        />

        {/* Drag handle */}
        <div
          className={`resize-handle${isDragging ? ' resize-handle--dragging' : ''}`}
          onMouseDown={handleMouseDown}
          title="Drag to resize"
        />

        {/* Right: Sidebar */}
        <Sidebar
          findings={findings}
          matchResults={matchResults}
          activeFindingId={activeFindingId}
          filters={filters}
          viewMode={viewMode}
          onFiltersChange={setFilters}
          onViewModeChange={setViewMode}
          onFindingClick={handleFindingClick}
          onSelectCandidate={selectCandidate}
          extractionProgress={extractionProgress}
          onOpenRulebook={openRulebook}
          width={sidebarWidth}
        />
      </div>

      <RulebookPanel
        rulebookUrl={rulebookUrl}
        isOpen={rulebookOpen}
        initialPage={rulebookPage}
        onClose={closeRulebook}
      />
    </AppShell>
  );
}
