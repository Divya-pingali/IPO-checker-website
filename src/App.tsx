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
import { HelpScreen } from './components/HelpScreen';

type View = 'upload' | 'viewer' | 'help';

export default function App() {
  // ── Navigation state ─────────────────────────────────────────────────────────
  const [view, setView] = useState<View>('upload');
  const [prevView, setPrevView] = useState<View>('upload');

  const goHelp = useCallback(() => {
    setPrevView(view);
    setView('help');
  }, [view]);

  const goBack = useCallback(() => {
    setView(prevView);
  }, [prevView]);

  const handleNewAnalysis = useCallback(() => setView('upload'), []);

  // ── Analysis state ───────────────────────────────────────────────────────────
  const [checkerData, setCheckerData] = useState<CheckerJson | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string>('');
  const prevBlobUrl = useRef<string>('');

  const handleAnalysisComplete = useCallback(
    (data: CheckerJson, blobUrl: string) => {
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
      prevBlobUrl.current = blobUrl;
      setCheckerData(data);
      setPdfBlobUrl(blobUrl);
      setView('viewer');
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
    };
  }, []);

  // ── Data loading ─────────────────────────────────────────────────────────────
  const { findings, meta, loading: jsonLoading, error: jsonError } =
    useFindingsParser(view === 'viewer' ? checkerData : null);

  const { pdfDoc, numPages, loading: pdfLoading, error: pdfError } =
    usePdfDocument(view === 'viewer' ? pdfBlobUrl : '');

  const { matchResults, extractionProgress, selectCandidate } =
    usePdfAnchorMatcher(pdfDoc, findings);

  const { rulebookUrl, rulebookOpen, openRulebook, closeRulebook, rulebookPage } =
    useRulebookReference('/rulebook_v2.pdf');

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

  if (view === 'help') {
    return (
      <HelpScreen
        onBack={goBack}
        onNewAnalysis={handleNewAnalysis}
      />
    );
  }

  if (view === 'upload') {
    return <UploadScreen onComplete={handleAnalysisComplete} onHelp={goHelp} />;
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
      onHelp={goHelp}
    >
      <div
        className="app-panels"
        style={{ userSelect: isDragging ? 'none' : undefined }}
      >
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

        <div
          className={`resize-handle${isDragging ? ' resize-handle--dragging' : ''}`}
          onMouseDown={handleMouseDown}
          title="Drag to resize"
        />

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
