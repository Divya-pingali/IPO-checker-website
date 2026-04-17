import React, { useMemo } from 'react';
import type { Finding, MatchResult, FilterState, ViewMode } from '../types';
import {
  groupByModule,
  collectFilterOptions,
  sortFindings,
} from '../utils/normalizeFindings';
import { FilterBar } from './FilterBar';
import { ModuleSection } from './ModuleSection';
import { FindingCard } from './FindingCard';

interface SidebarProps {
  findings: Finding[];
  matchResults: Map<string, MatchResult>;
  activeFindingId: string | null;
  filters: FilterState;
  viewMode: ViewMode;
  onFiltersChange: (f: FilterState) => void;
  onViewModeChange: (m: ViewMode) => void;
  onFindingClick: (finding: Finding) => void;
  onSelectCandidate: (findingId: string, index: number) => void;
  extractionProgress: number;
  onOpenRulebook: () => void;
  width?: number;
}

// ─── Filter application ───────────────────────────────────────────────────────

function applyFilters(findings: Finding[], filters: FilterState): Finding[] {
  // Tab gates the primary kind of finding shown
  let result = findings.filter((f) =>
    filters.tab === 'rules'
      ? f.kind === 'rule'
      : f.kind === 'reasoning_flag',
  );

  // Severity applies to both tabs
  if (filters.severity.length > 0) {
    result = result.filter((f) => filters.severity.includes(f.severity));
  }

  // Basic Rules tab — status / module / check-type filters
  if (filters.tab === 'rules') {
    if (filters.status.length > 0) {
      result = result.filter((f) => filters.status.includes(f.status));
    }
    if (filters.moduleId.length > 0) {
      result = result.filter((f) => filters.moduleId.includes(f.moduleId));
    }
    if (filters.checkType.length > 0) {
      result = result.filter((f) =>
        filters.checkType.some((ct) => f.checkTypes.includes(ct)),
      );
    }
  }

  // Overall Reasoning tab — category filter
  if (filters.tab === 'flags' && filters.category.length > 0) {
    result = result.filter(
      (f) => f.category && filters.category.includes(f.category),
    );
  }

  // Full-text search (both tabs)
  if (filters.search.trim()) {
    const q = filters.search.toLowerCase().trim();
    result = result.filter(
      (f) =>
        f.ruleId.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q) ||
        f.summary.toLowerCase().includes(q) ||
        f.moduleName.toLowerCase().includes(q) ||
        f.explanation.toLowerCase().includes(q),
    );
  }

  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const Sidebar: React.FC<SidebarProps> = ({
  findings,
  matchResults,
  activeFindingId,
  filters,
  viewMode,
  onFiltersChange,
  onViewModeChange,
  onFindingClick,
  onSelectCandidate,
  extractionProgress,
  onOpenRulebook,
  width,
}) => {
  const { severities, statuses, moduleIds, moduleNames, categories } = useMemo(
    () => collectFilterOptions(findings),
    [findings],
  );

  const filtered = useMemo(
    () => sortFindings(applyFilters(findings, filters)),
    [findings, filters],
  );

  // Findings whose PDF anchor could not be located
  const unresolvedFindings = useMemo(
    () =>
      filtered.filter((f) => {
        const r = matchResults.get(f.id);
        return r?.status === 'unresolved';
      }),
    [filtered, matchResults],
  );

  // Findings that ARE located (matched / ambiguous / no_anchor / no_page)
  const resolvedFindings = useMemo(
    () =>
      filtered.filter((f) => {
        const r = matchResults.get(f.id);
        return !r || r.status !== 'unresolved';
      }),
    [filtered, matchResults],
  );

  // Group resolved findings by module — only used in rules grouped view
  const groupedModules = useMemo(
    () => groupByModule(resolvedFindings),
    [resolvedFindings],
  );

  const isRules = filters.tab === 'rules';

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const renderCard = (f: Finding) => (
    <FindingCard
      key={f.id}
      finding={f}
      matchResult={matchResults.get(f.id)}
      isActive={f.id === activeFindingId}
      onClick={() => onFindingClick(f)}
      onSelectCandidate={onSelectCandidate}
    />
  );

  const renderUnresolvedSection = () =>
    unresolvedFindings.length > 0 ? (
      <div className="sidebar__unresolved-section">
        <div className="sidebar__unresolved-heading">
          Unresolved ({unresolvedFindings.length})
        </div>
        {unresolvedFindings.map(renderCard)}
      </div>
    ) : null;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <aside className="sidebar" style={width ? { width, flexShrink: 0 } : undefined}>
      {/* Header */}
      <div className="sidebar__header">
        <span className="sidebar__title">Findings</span>
        <button
          className="btn btn--sm btn--outline"
          onClick={onOpenRulebook}
          title="Open Rulebook reference"
        >
          Rulebook
        </button>
      </div>

      {/* Extraction progress */}
      {extractionProgress > 0 && extractionProgress < 1 && (
        <div className="sidebar__progress">
          <div
            className="sidebar__progress-bar"
            style={{ width: `${Math.round(extractionProgress * 100)}%` }}
          />
          <span className="sidebar__progress-label">
            Matching highlights… {Math.round(extractionProgress * 100)}%
          </span>
        </div>
      )}

      {/* Filter bar (tabs + context filters) */}
      <FilterBar
        filters={filters}
        onFiltersChange={onFiltersChange}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        severities={severities}
        statuses={statuses}
        moduleIds={moduleIds}
        moduleNames={moduleNames}
        categories={categories}
        totalCount={findings.filter((f) =>
          isRules ? f.kind === 'rule' : f.kind === 'reasoning_flag',
        ).length}
        filteredCount={filtered.length}
      />

      {/* Findings list */}
      <div className="sidebar__findings">

        {/* ── Basic Rules tab ─────────────────────────────────────────────── */}
        {isRules && viewMode === 'flat' && (
          <div className="sidebar__flat-list">
            {filtered.map(renderCard)}
            {filtered.length === 0 && (
              <div className="sidebar__empty">No findings match the current filters.</div>
            )}
          </div>
        )}

        {isRules && viewMode === 'grouped' && (
          <div className="sidebar__grouped-list">
            {[...groupedModules.entries()].map(([moduleId, mFindings]) => {
              const first = mFindings[0];
              return (
                <ModuleSection
                  key={moduleId}
                  moduleId={moduleId}
                  moduleName={first?.moduleName ?? moduleId}
                  findings={mFindings}
                  matchResults={matchResults}
                  activeFindingId={activeFindingId}
                  onFindingClick={onFindingClick}
                  onSelectCandidate={onSelectCandidate}
                />
              );
            })}
            {groupedModules.size === 0 && (
              <div className="sidebar__empty">No findings match the current filters.</div>
            )}
            {renderUnresolvedSection()}
          </div>
        )}

        {/* ── Overall Reasoning tab (always flat) ─────────────────────────── */}
        {!isRules && (
          <div className="sidebar__flat-list">
            {resolvedFindings.map(renderCard)}
            {filtered.length === 0 && (
              <div className="sidebar__empty">No reasoning flags match the current filters.</div>
            )}
            {renderUnresolvedSection()}
          </div>
        )}
      </div>
    </aside>
  );
};
