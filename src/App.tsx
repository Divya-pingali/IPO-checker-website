import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type {
  CheckerJson,
  Finding,
  FilterState,
  ReviewDecision,
  ViewMode,
} from './types';
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

const DEFAULT_PDF_PAGE_WIDTH = 595;
const INITIAL_PDF_SCALE = 1.4;
const PDF_VIEWER_HORIZONTAL_CHROME = 40;
const SIDEBAR_MIN_WIDTH = 360;
const SIDEBAR_MAX_WIDTH = 760;
const DEFAULT_FILTERS: FilterState = {
  tab: 'rules',
  severity: [],
  status: [],
  moduleId: [],
  checkType: [],
  category: [],
  review: 'pending',
  search: '',
};

function calculateSidebarWidth(viewportWidth: number, pdfPageWidth: number): number {
  const pdfWidth = pdfPageWidth * INITIAL_PDF_SCALE + PDF_VIEWER_HORIZONTAL_CHROME;
  const availableForSidebar = viewportWidth - pdfWidth;
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.floor(availableForSidebar)),
  );
}

export default function App() {
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, ReviewDecision>>({});

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
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );
  const [pdfPageWidth, setPdfPageWidth] = useState(DEFAULT_PDF_PAGE_WIDTH);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!pdfDoc) {
      setPdfPageWidth(DEFAULT_PDF_PAGE_WIDTH);
      return;
    }

    let cancelled = false;
    pdfDoc.getPage(1).then((page) => {
      if (!cancelled) setPdfPageWidth(page.getViewport({ scale: 1 }).width);
    }).catch(() => {
      if (!cancelled) setPdfPageWidth(DEFAULT_PDF_PAGE_WIDTH);
    });

    return () => {
      cancelled = true;
    };
  }, [pdfDoc]);

  const defaultSidebarWidth = useMemo(
    () => calculateSidebarWidth(viewportWidth, pdfPageWidth),
    [viewportWidth, pdfPageWidth],
  );

  const { sidebarWidth, isDragging, handleMouseDown } = useResizablePanels({
    defaultSidebarWidth,
    minSidebarWidth: SIDEBAR_MIN_WIDTH,
    maxSidebarWidth: SIDEBAR_MAX_WIDTH,
    resetKey: pdfDoc,
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
  const [scale, setScale] = useState(INITIAL_PDF_SCALE);
  const [scrollToPage, setScrollToPage] = useState<number | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [viewMode, setViewMode] = useState<ViewMode>('flat');

  useEffect(() => {
    if (!checkerData) return;
    setActiveFindingId(null);
    setCurrentPage(1);
    setScale(INITIAL_PDF_SCALE);
    setScrollToPage(null);
    setFilters(DEFAULT_FILTERS);
    setViewMode('flat');
  }, [checkerData]);

  const reviewStorageKey = useMemo(() => {
    if (!checkerData?.meta) return null;
    const { company_name, analysis_date, rulebook_version } = checkerData.meta;
    return `checker-review:${company_name}:${analysis_date}:${rulebook_version}`;
  }, [checkerData]);

  useEffect(() => {
    if (!reviewStorageKey) {
      setReviewDecisions({});
      return;
    }

    try {
      const raw = window.localStorage.getItem(reviewStorageKey);
      setReviewDecisions(raw ? (JSON.parse(raw) as Record<string, ReviewDecision>) : {});
    } catch {
      setReviewDecisions({});
    }
  }, [reviewStorageKey]);

  useEffect(() => {
    if (!reviewStorageKey) return;
    window.localStorage.setItem(reviewStorageKey, JSON.stringify(reviewDecisions));
  }, [reviewDecisions, reviewStorageKey]);

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
      const targetFindingId = finding.parentFindingId ?? finding.id;
      setActiveFindingId((prev) => (prev === targetFindingId ? null : targetFindingId));
      const result = matchResults.get(targetFindingId);
      const candidate = result?.candidates[result.selectedCandidateIndex] ?? null;
      const targetPage = candidate?.page ?? finding.page;
      if (targetPage) {
        setScrollToPage(targetPage);
        setCurrentPage(targetPage);
        window.setTimeout(() => {
          const el = document.querySelector<HTMLElement>(
            `[data-highlight-id="${targetFindingId}"]`,
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

  const handleReviewDecision = useCallback(
    (decisionKey: string, decision: ReviewDecision | null) => {
      setReviewDecisions((prev) => {
        if (decision === null) {
          if (!(decisionKey in prev)) return prev;
          const next = { ...prev };
          delete next[decisionKey];
          return next;
        }

        if (prev[decisionKey] === decision) return prev;
        return { ...prev, [decisionKey]: decision };
      });
    },
    [],
  );

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
          checkerJson={checkerData}
          matchResults={matchResults}
          activeFindingId={activeFindingId}
          filters={filters}
          viewMode={viewMode}
          reviewDecisions={reviewDecisions}
          onFiltersChange={setFilters}
          onViewModeChange={setViewMode}
          onFindingClick={handleFindingClick}
          onSelectCandidate={selectCandidate}
          onReviewDecision={handleReviewDecision}
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
