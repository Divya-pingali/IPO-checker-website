import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../hooks/usePdfDocument';
import type { MatchResult } from '../types';
import { HighlightLayer } from './HighlightLayer';

interface PageRendererProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  matchResults: Map<string, MatchResult>;
  activeFindingId: string | null;
  onHighlightClick: (findingId: string) => void;
  /** Ref callback so the parent can scroll to this page */
  pageRef?: (el: HTMLDivElement | null) => void;
  severityMap?: Map<string, string>;
  statusMap?: Map<string, string>;
}

const EXTRACTION_SCALE = 1.0;

export const PageRenderer: React.FC<PageRendererProps> = ({
  pdfDoc,
  pageNumber,
  scale,
  matchResults,
  activeFindingId,
  onHighlightClick,
  pageRef,
  severityMap,
  statusMap,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        setPageSize({ width: viewport.width, height: viewport.height });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Device pixel ratio for crisp rendering on high-DPI displays
        const dpr = window.devicePixelRatio || 1;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        ctx.scale(dpr, dpr);

        renderTaskRef.current?.cancel();

        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
        });
        renderTaskRef.current = renderTask;

        await renderTask.promise;
      } catch (err: unknown) {
        // Ignore cancellation errors
        if ((err as { name?: string })?.name !== 'RenderingCancelledException') {
          console.error(`Page ${pageNumber} render error:`, err);
        }
      }
    }

    render();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [pdfDoc, pageNumber, scale]);

  return (
    <div
      ref={pageRef}
      data-page={pageNumber}
      style={{
        position: 'relative',
        display: 'inline-block',
        margin: '0 auto 16px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
        background: '#fff',
        lineHeight: 0,
        width: pageSize?.width ?? 'auto',
        height: pageSize?.height ?? 'auto',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {pageSize && (
        <HighlightLayer
          pageNumber={pageNumber}
          matchResults={matchResults}
          activeFindingId={activeFindingId}
          scale={scale}
          extractionScale={EXTRACTION_SCALE}
          onHighlightClick={onHighlightClick}
          severityMap={severityMap}
          statusMap={statusMap}
        />
      )}
      <div
        style={{
          position: 'absolute',
          bottom: 4,
          right: 6,
          fontSize: 10,
          color: '#999',
          background: 'rgba(255,255,255,0.7)',
          padding: '1px 4px',
          borderRadius: 3,
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {pageNumber}
      </div>
    </div>
  );
};
