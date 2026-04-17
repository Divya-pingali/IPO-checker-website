import React from 'react';
import type { CheckerJson } from '../types';

interface AppShellProps {
  meta: CheckerJson['meta'] | null;
  pdfLoading: boolean;
  jsonLoading: boolean;
  extractionProgress: number;
  children: React.ReactNode;
  onNewAnalysis?: () => void;
}

/**
 * Outer shell: top nav bar + two-panel layout container.
 * Drop-in for any prospectus+checker JSON pair — company name and dates come
 * from the checker JSON meta, not from hardcoded values.
 */
export const AppShell: React.FC<AppShellProps> = ({
  meta,
  pdfLoading,
  jsonLoading,
  extractionProgress,
  children,
  onNewAnalysis,
}) => {
  const isLoading = pdfLoading || jsonLoading;

  return (
    <div className="app-shell">
      {/* Top bar */}
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">Linklaters</span>
          <span className="topbar__separator">|</span>
          <span className="topbar__title">Prospectus Review</span>
        </div>

        {meta && (
          <div className="topbar__meta">
            <span className="topbar__company">{meta.company_name}</span>
            <span className="topbar__divider">·</span>
            <span className="topbar__rulebook-ver">Rulebook {meta.rulebook_version}</span>
            <span className="topbar__divider">·</span>
            <span className="topbar__date">{meta.analysis_date}</span>
          </div>
        )}

        {onNewAnalysis && (
          <button className="topbar__new-btn" onClick={onNewAnalysis} title="Analyse a new document">
            ↑ New Analysis
          </button>
        )}

        <div className="topbar__status">
          {isLoading && (
            <span className="topbar__loading">
              <span className="spinner spinner--sm" />
              {pdfLoading ? 'Loading PDF…' : 'Parsing findings…'}
            </span>
          )}
          {!isLoading && extractionProgress > 0 && extractionProgress < 1 && (
            <span className="topbar__matching">
              Matching {Math.round(extractionProgress * 100)}%
            </span>
          )}
          {!isLoading && extractionProgress >= 1 && (
            <span className="topbar__done">Ready</span>
          )}
        </div>
      </header>

      {/* Main content (injected by App) */}
      <main className="app-body">{children}</main>
    </div>
  );
};
