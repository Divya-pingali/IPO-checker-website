import React, { useEffect, useRef, useState } from 'react';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { PageRenderer } from './PageRenderer';

interface RulebookPanelProps {
  rulebookUrl: string;
  isOpen: boolean;
  initialPage?: number;
  onClose: () => void;
}

/**
 * Modal panel displaying the rulebook PDF.
 * Provides its own navigation; can be extended in future to parse module/rule
 * metadata from the rulebook and surface it as tooltip/help text.
 */
export const RulebookPanel: React.FC<RulebookPanelProps> = ({
  rulebookUrl,
  isOpen,
  initialPage = 1,
  onClose,
}) => {
  const { pdfDoc, numPages, loading, error } = usePdfDocument(
    isOpen ? rulebookUrl : '',
  );

  const [page, setPage] = useState(initialPage);
  const [scale, setScale] = useState(1.2);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Reset page when panel opens with a new hint
  useEffect(() => {
    if (isOpen) setPage(initialPage);
  }, [isOpen, initialPage]);

  // Scroll to page
  useEffect(() => {
    const el = pageRefs.current.get(page);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [page]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="rulebook-overlay" onClick={onClose}>
      <div className="rulebook-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="rulebook-panel__header">
          <span className="rulebook-panel__title">Rulebook Reference</span>
          <div className="rulebook-panel__controls">
            <button
              className="btn btn--icon"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹
            </button>
            <input
              className="pdf-toolbar__page-input"
              type="number"
              min={1}
              max={numPages || 1}
              value={page}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!isNaN(n) && n >= 1 && n <= numPages) setPage(n);
              }}
            />
            <span style={{ color: '#888', fontSize: 13 }}>/ {numPages}</span>
            <button
              className="btn btn--icon"
              disabled={page >= numPages}
              onClick={() => setPage((p) => Math.min(numPages, p + 1))}
            >
              ›
            </button>
            <button
              className="btn btn--icon"
              onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
              title="Zoom out"
            >
              −
            </button>
            <span style={{ fontSize: 12, color: '#666', minWidth: 38, textAlign: 'center' }}>
              {Math.round(scale * 100)}%
            </span>
            <button
              className="btn btn--icon"
              onClick={() => setScale((s) => Math.min(3.0, s + 0.25))}
              title="Zoom in"
            >
              +
            </button>
          </div>
          <button className="btn btn--icon rulebook-panel__close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="rulebook-panel__body">
          {loading && (
            <div className="pdf-loading">
              <div className="spinner" />
              <span>Loading rulebook…</span>
            </div>
          )}
          {error && (
            <div className="pdf-error">
              <strong>Rulebook load error:</strong>
              <br />
              {error}
            </div>
          )}
          {pdfDoc && !loading && (
            <div className="pdf-pages">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
                <PageRenderer
                  key={p}
                  pdfDoc={pdfDoc}
                  pageNumber={p}
                  scale={scale}
                  matchResults={new Map()}
                  activeFindingId={null}
                  onHighlightClick={() => {}}
                  pageRef={(el) => {
                    if (el) pageRefs.current.set(p, el);
                    else pageRefs.current.delete(p);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
