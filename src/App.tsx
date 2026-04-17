import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { CheckerJson, Finding, FilterState, ViewMode } from './types';
import { useFindingsParser } from './hooks/useFindingsParser';
import { usePdfDocument } from './hooks/usePdfDocument';
import { usePdfAnchorMatcher } from './hooks/usePdfAnchorMatcher';
import { useRulebookReference } from './hooks/useRulebookReference';
import { useResizablePanels } from './hooks/useResizablePanels';
import { AppShell } from './components/AppShell';
import { PdfViewer } from './components/PdfViewer';
import { Sidebar } from './components/Sidebar';
import { RulebookPanel } from './components/RulebookPanel';
import { UploadScreen } from './components/UploadScreen';

export default function App() {
  // ── Upload / viewer state ────────────────────────────────────────────────────
  const [view, setView] = useState<'upload' | 'viewer'>('upload');
  const [checkerData, setCheckerData] = useState<CheckerJson | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string>('');
  // Keep a ref to the blob URL so we can revoke it when replaced
  const prevBlobUrl = useRef<string>('');

  const handleAnalysisComplete = useCallback(
    (data: CheckerJson, blobUrl: string) => {
      // Revoke old blob URL to avoid memory leaks
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
      prevBlobUrl.current = blobUrl;
      setCheckerData(data);
      setPdfBlobUrl(blobUrl);
      setView('viewer');
    },
    [],
  );

  const handleNewAnalysis = useCallback(() => {
    setView('upload');
  }, []);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
    };
  }, []);

  // ── Data loading ─────────────────────────────────────────────────────────────
  // useFindingsParser accepts a CheckerJson object directly — no fetch needed
  const { findings, meta, loading: jsonLoading, error: jsonError } =
    useFindingsParser(view === 'viewer' ? checkerData : null);

  const { pdfDoc, numPages, loading: pdfLoading, error: pdfError } =
    usePdfDocument(view === 'viewer' ? pdfBlobUrl : '');

  const { matchResults, extractionProgress, selectCandidate } =
    usePdfAnchorMatcher(pdfDoc, findings);

  const { rulebookUrl, rulebookOpen, openRulebook, closeRulebook, rulebookPage } =
    useRulebookReference('/rulebook.pdf');

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

  if (view === 'upload') {
    return <UploadScreen onComplete={handleAnalysisComplete} />;
  }

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
      onNewAnalysis={handleNewAnalysis}
    >
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
