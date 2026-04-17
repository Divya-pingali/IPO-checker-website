import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { PDFDocumentProxy } from '../hooks/usePdfDocument';
import type { MatchResult } from '../types';
import { PageRenderer } from './PageRenderer';

interface PdfViewerProps {
  pdfDoc: PDFDocumentProxy | null;
  numPages: number;
  loadingPdf: boolean;
  pdfError: string | null;
  scale: number;
  currentPage: number;
  matchResults: Map<string, MatchResult>;
  activeFindingId: string | null;
  onHighlightClick: (findingId: string) => void;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  /** When set, viewer scrolls to this page */
  scrollToPage: number | null;
  severityMap?: Map<string, string>;
  statusMap?: Map<string, string>;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const SCALE_STEP = 0.25;

export const PdfViewer: React.FC<PdfViewerProps> = ({
  pdfDoc,
  numPages,
  loadingPdf,
  pdfError,
  scale,
  currentPage,
  matchResults,
  activeFindingId,
  onHighlightClick,
  onPageChange,
  onScaleChange,
  scrollToPage,
  severityMap,
  statusMap,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [inputPage, setInputPage] = useState(String(currentPage));
  const observerRef = useRef<IntersectionObserver | null>(null);

  // ── Register page refs ────────────────────────────────────────────────────
  const setPageRef = useCallback(
    (pageNum: number) => (el: HTMLDivElement | null) => {
      if (el) pageRefs.current.set(pageNum, el);
      else pageRefs.current.delete(pageNum);
    },
    [],
  );

  // ── Scroll to page ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!scrollToPage) return;
    const el = pageRefs.current.get(scrollToPage);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [scrollToPage]);

  // ── Track current page via IntersectionObserver ──────────────────────────
  useEffect(() => {
    observerRef.current?.disconnect();
    const container = scrollRef.current;
    if (!container || numPages === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let best: { page: number; ratio: number } | null = null;
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (!isNaN(page) && entry.intersectionRatio > (best?.ratio ?? 0)) {
            best = { page, ratio: entry.intersectionRatio };
          }
        }
        if (best) {
          onPageChange(best.page);
          setInputPage(String(best.page));
        }
      },
      { root: container, threshold: [0.1, 0.5, 0.9] },
    );

    for (const [, el] of pageRefs.current) observer.observe(el);
    observerRef.current = observer;

    return () => observer.disconnect();
  }, [numPages, onPageChange]);

  // ── Keep input in sync when navigating from sidebar ──────────────────────
  useEffect(() => {
    setInputPage(String(currentPage));
  }, [currentPage]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const zoomIn = () => onScaleChange(Math.min(scale + SCALE_STEP, MAX_SCALE));
  const zoomOut = () => onScaleChange(Math.max(scale - SCALE_STEP, MIN_SCALE));

  const handlePageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputPage(e.target.value);
  };

  const commitPageInput = () => {
    const n = parseInt(inputPage, 10);
    if (!isNaN(n) && n >= 1 && n <= numPages) {
      const el = pageRefs.current.get(n);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      setInputPage(String(currentPage));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="pdf-viewer">
      {/* Toolbar */}
      <div className="pdf-toolbar">
        <div className="pdf-toolbar__nav">
          <button
            className="btn btn--icon"
            onClick={() => {
              const prev = Math.max(1, currentPage - 1);
              const el = pageRefs.current.get(prev);
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            disabled={currentPage <= 1}
            title="Previous page"
          >
            ‹
          </button>
          <div className="pdf-toolbar__page-input-wrap">
            <input
              className="pdf-toolbar__page-input"
              type="number"
              min={1}
              max={numPages}
              value={inputPage}
              onChange={handlePageInput}
              onBlur={commitPageInput}
              onKeyDown={(e) => e.key === 'Enter' && commitPageInput()}
            />
            <span className="pdf-toolbar__page-total">/ {numPages}</span>
          </div>
          <button
            className="btn btn--icon"
            onClick={() => {
              const next = Math.min(numPages, currentPage + 1);
              const el = pageRefs.current.get(next);
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            disabled={currentPage >= numPages}
            title="Next page"
          >
            ›
          </button>
        </div>

        <div className="pdf-toolbar__zoom">
          <button className="btn btn--icon" onClick={zoomOut} title="Zoom out">
            −
          </button>
          <span className="pdf-toolbar__zoom-level">{Math.round(scale * 100)}%</span>
          <button className="btn btn--icon" onClick={zoomIn} title="Zoom in">
            +
          </button>
          <button
            className="btn btn--sm"
            onClick={() => onScaleChange(1.0)}
            title="Reset zoom"
          >
            Reset
          </button>
          <button
            className="btn btn--sm"
            onClick={() => onScaleChange(1.5)}
            title="Fit width (approx)"
          >
            Fit
          </button>
        </div>
      </div>

      {/* Scroll area */}
      <div className="pdf-scroll-area" ref={scrollRef}>
        {loadingPdf && (
          <div className="pdf-loading">
            <div className="spinner" />
            <span>Loading PDF…</span>
          </div>
        )}
        {pdfError && (
          <div className="pdf-error">
            <strong>PDF load error:</strong>
            <br />
            {pdfError}
          </div>
        )}
        {pdfDoc && !loadingPdf && (
          <div className="pdf-pages">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
              <PageRenderer
                key={pageNum}
                pdfDoc={pdfDoc}
                pageNumber={pageNum}
                scale={scale}
                matchResults={matchResults}
                activeFindingId={activeFindingId}
                onHighlightClick={onHighlightClick}
                pageRef={setPageRef(pageNum)}
                severityMap={severityMap}
                statusMap={statusMap}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
