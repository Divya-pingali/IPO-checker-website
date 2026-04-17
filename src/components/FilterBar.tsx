import React from 'react';
import type { FilterState, ViewMode } from '../types';

interface FilterBarProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  severities: string[];
  statuses: string[];
  moduleIds: string[];
  moduleNames: Map<string, string>;
  categories: string[];
  totalCount: number;
  filteredCount: number;
}

const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low'];

const CHECK_TYPES = [
  {
    code: 'D',
    label: 'DISCLOSURE',
    description:
      'Is the required item present and specific enough to be meaningful? Fails on "absent" or "insufficient".',
  },
  {
    code: 'T',
    label: 'THRESHOLD',
    description:
      'Does the disclosed figure meet a quantitative requirement? Requires a prior [D] check to have passed.',
  },
  {
    code: 'K',
    label: 'CONSISTENCY',
    description:
      'Does the disclosed information match the equivalent data in other specified sections?',
  },
  {
    code: 'L',
    label: 'LANGUAGE QUALITY',
    description:
      'Is the disclosure fairly presented, in plain language, accurate, complete, and not misleading?',
  },
  {
    code: 'R',
    label: 'REASONING',
    description:
      'Does the disclosed evidence logically support the claimed conclusion?',
  },
];

function sortedSeverities(severities: string[]): string[] {
  return [...severities].sort(
    (a, b) =>
      (SEVERITY_ORDER.indexOf(a) + 1 || 99) -
      (SEVERITY_ORDER.indexOf(b) + 1 || 99),
  );
}

function toggleArrayItem(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

/** Pretty-print a raw category string from JSON, e.g. "RISK_FACTORS_COMPLETENESS" → "Risk Factors Completeness" */
function formatCategory(raw: string): string {
  return raw
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onFiltersChange,
  viewMode,
  onViewModeChange,
  severities,
  statuses,
  moduleIds,
  moduleNames,
  categories,
  totalCount,
  filteredCount,
}) => {
  const isRules = filters.tab === 'rules';

  // ── Tab switching ───────────────────────────────────────────────────────────
  const switchTab = (tab: FilterState['tab']) => {
    if (tab === filters.tab) return;
    onFiltersChange({
      ...filters,
      tab,
      // Clear tab-specific filters; preserve search + severity (tab-agnostic)
      ...(tab === 'rules'
        ? { category: [] }
        : { status: [], moduleId: [], checkType: [] }),
    });
  };

  // ── Generic toggle helper ───────────────────────────────────────────────────
  const toggle = (
    field: 'severity' | 'status' | 'moduleId' | 'checkType' | 'category',
    value: string,
  ) => {
    onFiltersChange({
      ...filters,
      [field]: toggleArrayItem(filters[field] as string[], value),
    });
  };

  // ── Clear filters (within current tab) ─────────────────────────────────────
  const clearAll = () => {
    onFiltersChange({
      ...filters,
      severity: [],
      status: [],
      moduleId: [],
      checkType: [],
      category: [],
      search: '',
    });
  };

  const hasFilters =
    filters.severity.length > 0 ||
    filters.status.length > 0 ||
    filters.moduleId.length > 0 ||
    filters.checkType.length > 0 ||
    filters.category.length > 0 ||
    filters.search.length > 0;

  return (
    <div className="filter-bar">

      {/* ── Top-level tabs ─────────────────────────────────────────────────── */}
      <div className="filter-bar__tabs">
        <button
          className={`filter-bar__tab ${isRules ? 'filter-bar__tab--active' : ''}`}
          onClick={() => switchTab('rules')}
        >
          Basic Rules
        </button>
        <button
          className={`filter-bar__tab ${!isRules ? 'filter-bar__tab--active' : ''}`}
          onClick={() => switchTab('flags')}
        >
          Overall Reasoning
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <div className="filter-bar__search">
        <input
          className="filter-bar__search-input"
          type="search"
          placeholder="Search findings…"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
        />
      </div>

      {/* ── View mode (Basic Rules only) ────────────────────────────────────── */}
      {isRules && (
        <div className="filter-bar__view-toggle">
          <button
            className={`btn btn--sm ${viewMode === 'grouped' ? 'btn--active' : ''}`}
            onClick={() => onViewModeChange('grouped')}
          >
            Grouped
          </button>
          <button
            className={`btn btn--sm ${viewMode === 'flat' ? 'btn--active' : ''}`}
            onClick={() => onViewModeChange('flat')}
          >
            Flat
          </button>
        </div>
      )}

      {/* ── Severity (both tabs) ────────────────────────────────────────────── */}
      {severities.length > 0 && (
        <div className="filter-bar__section">
          <span className="filter-bar__label">Severity</span>
          <div className="filter-bar__chips">
            {sortedSeverities(severities).map((s) => (
              <button
                key={s}
                className={`chip chip--severity chip--${s.toLowerCase()} ${
                  filters.severity.includes(s) ? 'chip--active' : ''
                }`}
                onClick={() => toggle('severity', s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Basic Rules filters ─────────────────────────────────────────────── */}
      {isRules && (
        <>
          {/* Status */}
          {statuses.length > 0 && (
            <div className="filter-bar__section">
              <span className="filter-bar__label">Status</span>
              <div className="filter-bar__chips">
                {statuses.map((s) => (
                  <button
                    key={s}
                    className={`chip chip--status chip--status-${s
                      .toLowerCase()
                      .replace(/\s+/g, '-')} ${
                      filters.status.includes(s) ? 'chip--active' : ''
                    }`}
                    onClick={() => toggle('status', s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Module */}
          {moduleIds.length > 0 && (
            <div className="filter-bar__section">
              <span className="filter-bar__label">Module</span>
              <div className="filter-bar__chips filter-bar__chips--wrap">
                {moduleIds.map((id) => (
                  <button
                    key={id}
                    className={`chip chip--module ${
                      filters.moduleId.includes(id) ? 'chip--active' : ''
                    }`}
                    onClick={() => toggle('moduleId', id)}
                    title={moduleNames.get(id) ?? id}
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Check types */}
          <div className="filter-bar__section">
            <span className="filter-bar__label">Checks</span>
            <div className="filter-bar__chips">
              {CHECK_TYPES.map(({ code, label, description }) => (
                <button
                  key={code}
                  className={`check-type-btn ${
                    filters.checkType.includes(code) ? 'check-type-btn--active' : ''
                  }`}
                  onClick={() => toggle('checkType', code)}
                  title={`[${code}] ${label} — ${description}`}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Overall Reasoning filters ───────────────────────────────────────── */}
      {!isRules && categories.length > 0 && (
        <div className="filter-bar__section">
          <span className="filter-bar__label filter-bar__label--wide">Category</span>
          <div className="filter-bar__chips filter-bar__chips--wrap">
            {categories.map((cat) => (
              <button
                key={cat}
                className={`chip ${filters.category.includes(cat) ? 'chip--active' : ''}`}
                onClick={() => toggle('category', cat)}
                title={cat}
              >
                {formatCategory(cat)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Count + clear ───────────────────────────────────────────────────── */}
      <div className="filter-bar__footer">
        <span className="filter-bar__count">
          {filteredCount} / {totalCount}
        </span>
        {hasFilters && (
          <button className="btn btn--sm btn--ghost" onClick={clearAll}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
};
