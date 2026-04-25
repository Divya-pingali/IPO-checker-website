import React, { useMemo } from 'react';
import type {
  Finding,
  MatchResult,
  FilterState,
  ViewMode,
  CheckerJson,
  ReviewDecision,
} from '../types';
import {
  groupByModule,
  collectFilterOptions,
  sortFindings,
} from '../utils/normalizeFindings';
import {
  getReviewDecisionForFinding,
  matchesReviewFilter,
} from '../utils/reviewState';
import { FilterBar } from './FilterBar';
import { ModuleSection } from './ModuleSection';
import { FindingCard } from './FindingCard';

interface SidebarProps {
  findings: Finding[];
  matchResults: Map<string, MatchResult>;
  activeFindingId: string | null;
  filters: FilterState;
  viewMode: ViewMode;
  reviewDecisions: Record<string, ReviewDecision>;
  onFiltersChange: (f: FilterState) => void;
  onViewModeChange: (m: ViewMode) => void;
  onFindingClick: (finding: Finding) => void;
  onSelectCandidate: (findingId: string, index: number) => void;
  onReviewDecision: (decisionKey: string, decision: ReviewDecision | null) => void;
  extractionProgress: number;
  onOpenRulebook: () => void;
  width?: number;
  checkerJson?: CheckerJson | null;
}

// ─── Filter application ───────────────────────────────────────────────────────

function applyFilters(
  findings: Finding[],
  filters: FilterState,
  reviewDecisions: Record<string, ReviewDecision>,
): Finding[] {
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

  return result.filter((finding) =>
    matchesReviewFilter(finding, reviewDecisions, filters.review),
  );
}

function flattenRuleChecks(findings: Finding[]): Finding[] {
  return findings.flatMap((finding) => {
    if (finding.kind !== 'rule' || !finding.findings || finding.findings.length === 0) {
      return [finding];
    }

    return finding.findings.map((item, index) => ({
      ...finding,
      id: `${finding.id}::${item.check_type}::${index}`,
      parentFindingId: finding.id,
      severity: item.severity,
      status: item.issue_type,
      statusColour: item.issue_type === 'Absent' ? 'red' : 'amber',
      summary: item.explanation,
      explanation: item.explanation,
      recommendation: item.recommendation ?? '',
      page: item.source_anchor?.page ?? finding.page,
      anchorText: item.source_anchor?.anchor_phrase ?? finding.anchorText,
      sourceFile: item.source_anchor?.source_file ?? finding.sourceFile,
      sourceAnchors: item.source_anchor ? [item.source_anchor] : finding.sourceAnchors,
      checkTypes: [item.check_type],
      findings: [item],
    }));
  });
}

function formatCategoryName(raw: string): string {
  return raw
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function buildModuleSummary(mod: {
  triggered: boolean;
  findings: Finding[];
  not_applicable_reason?: string;
}): string {
  if (!mod.triggered) return 'Not applicable for this applicant';
  if (mod.findings.length === 0) return 'No issues raised in this module';

  const missing = mod.findings.filter((f) => f.status === 'Absent').length;
  const needsDetail = mod.findings.filter((f) => f.status === 'Insufficient').length;
  const clear = mod.findings.filter((f) => f.status === 'Present').length;
  const notApplicable = mod.findings.filter((f) => f.status === 'Not Applicable').length;
  const critical = mod.findings.filter((f) => f.severity === 'Critical').length;

  const parts: string[] = [];
  if (missing > 0) parts.push(`${missing} missing disclosure${missing === 1 ? '' : 's'}`);
  if (needsDetail > 0) parts.push(`${needsDetail} needs-detail item${needsDetail === 1 ? '' : 's'}`);
  if (missing === 0 && needsDetail === 0 && clear > 0) parts.push(`${clear} clear`);
  if (notApplicable > 0 && missing === 0 && needsDetail === 0) parts.push(`${notApplicable} not applicable`);
  if (critical > 0) parts.push(`${critical} critical`);
  return parts.join(' · ');
}

// ─── Component ────────────────────────────────────────────────────────────────

export const Sidebar: React.FC<SidebarProps> = ({
  findings,
  matchResults,
  activeFindingId,
  filters,
  viewMode,
  reviewDecisions,
  onFiltersChange,
  onViewModeChange,
  onFindingClick,
  onSelectCandidate,
  onReviewDecision,
  extractionProgress,
  onOpenRulebook,
  width,
  checkerJson,
}) => {
  const baseDisplayFindings = useMemo(() => {
    if (filters.tab === 'rules') {
      return viewMode === 'flat'
        ? flattenRuleChecks(findings)
        : findings.filter((finding) => finding.kind === 'rule');
    }

    return findings.filter((finding) => finding.kind === 'reasoning_flag');
  }, [filters.tab, findings, viewMode]);

  const displayFindings = useMemo(() => {
    return baseDisplayFindings;
  }, [baseDisplayFindings]);

  const { severities, statuses, moduleIds, moduleNames, categories } = useMemo(
    () => collectFilterOptions(displayFindings),
    [displayFindings],
  );

  // All module IDs in JSON order (includes triggered-but-clear and N/A modules)
  const allModuleIds = useMemo(
    () => checkerJson?.modules?.map((m) => m.module_id) ?? moduleIds,
    [checkerJson, moduleIds],
  );

  const allModuleNames = useMemo(() => {
    const map = new Map(moduleNames);
    for (const m of checkerJson?.modules ?? []) map.set(m.module_id, m.module_name);
    return map;
  }, [checkerJson, moduleNames]);

  const filtered = useMemo(
    () => sortFindings(applyFilters(displayFindings, filters, reviewDecisions)),
    [displayFindings, filters, reviewDecisions],
  );

  // Findings whose PDF anchor could not be located
  const unresolvedFindings = useMemo(
    () =>
      filtered.filter((f) => {
        const r = matchResults.get(f.parentFindingId ?? f.id);
        return r?.status === 'unresolved';
      }),
    [filtered, matchResults],
  );

  // Findings that ARE located (matched / ambiguous / no_anchor / no_page)
  const resolvedFindings = useMemo(
    () =>
      filtered.filter((f) => {
        const r = matchResults.get(f.parentFindingId ?? f.id);
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
  const hasActiveRuleNarrowing =
    filters.severity.length > 0 ||
    filters.status.length > 0 ||
    filters.checkType.length > 0 ||
    filters.search.trim().length > 0;
  const wantsPresentModules = filters.status.includes('Present');
  const wantsNotApplicableModules = filters.status.includes('Not Applicable');

  const groupedModuleList = useMemo(() => {
    const modules =
      checkerJson?.modules ??
      [...groupedModules.entries()].map(([id]) => ({
        module_id: id,
        module_name: allModuleNames.get(id) ?? id,
        triggered: true,
        not_applicable_reason: undefined as string | undefined,
      }));

    return modules
      .map((mod) => {
        const typedMod = mod as {
          module_id: string;
          module_name: string;
          triggered: boolean;
          not_applicable_reason?: string;
        };
        const mFindings = resolvedFindings.filter((f) => f.moduleId === typedMod.module_id);
        return { ...typedMod, findings: mFindings };
      })
      .filter((mod) => {
        if (filters.moduleId.length > 0 && !filters.moduleId.includes(mod.module_id)) {
          return false;
        }
        if (filters.search.trim()) {
          const q = filters.search.toLowerCase().trim();
          const moduleMatches =
            mod.module_id.toLowerCase().includes(q) ||
            mod.module_name.toLowerCase().includes(q) ||
            (mod.not_applicable_reason ?? '').toLowerCase().includes(q);

          if (!moduleMatches && mod.findings.length === 0) {
            return false;
          }
        }

        if (filters.status.length > 0 && mod.findings.length === 0) {
          if (mod.triggered === false) {
            return wantsNotApplicableModules;
          }
          return wantsPresentModules;
        }
        if (hasActiveRuleNarrowing && mod.findings.length === 0) {
          return false;
        }
        return true;
      });
  }, [
    allModuleNames,
    checkerJson,
    filters.checkType,
    filters.moduleId,
    filters.search,
    filters.severity,
    filters.status,
    groupedModules,
    hasActiveRuleNarrowing,
    resolvedFindings,
    wantsNotApplicableModules,
    wantsPresentModules,
  ]);

  const groupedFlagList = useMemo(() => {
    const grouped = new Map<string, Finding[]>();

    for (const finding of resolvedFindings) {
      if (finding.kind !== 'reasoning_flag') continue;
      const key = finding.category ?? 'UNCATEGORISED';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(finding);
    }

    return [...grouped.entries()]
      .map(([category, categoryFindings]) => ({
        category,
        label: formatCategoryName(category),
        findings: sortFindings(categoryFindings),
      }))
      .filter((group) => {
        if (filters.category.length > 0 && !filters.category.includes(group.category)) {
          return false;
        }
        if (filters.search.trim() && group.findings.length === 0) {
          return false;
        }
        return true;
      });
  }, [displayFindings.length, filters.category, filters.search, resolvedFindings]);

  const totalDisplayCount = useMemo(() => {
    if (!isRules) return displayFindings.filter((f) => f.kind === 'reasoning_flag').length;
    if (viewMode === 'grouped') {
      return checkerJson?.modules?.length ?? groupedModuleList.length;
    }
    return displayFindings.filter((f) => f.kind === 'rule').length;
  }, [checkerJson, displayFindings, groupedModuleList.length, isRules, viewMode]);

  const filteredDisplayCount = useMemo(() => {
    if (!isRules) return filtered.length;
    if (viewMode === 'grouped') return groupedModuleList.length;
    return filtered.length;
  }, [filtered.length, groupedModuleList.length, isRules, viewMode]);

  const countLabel = useMemo(() => {
    if (!isRules) return filteredDisplayCount === 1 ? 'flag' : 'flags';
    if (viewMode === 'grouped') return filteredDisplayCount === 1 ? 'module' : 'modules';
    return filteredDisplayCount === 1 ? 'check' : 'checks';
  }, [filteredDisplayCount, isRules, viewMode]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const renderCard = (f: Finding) => (
    <FindingCard
      key={f.id}
      finding={f}
      matchResult={matchResults.get(f.parentFindingId ?? f.id)}
      isActive={(f.parentFindingId ?? f.id) === activeFindingId}
      reviewDecision={getReviewDecisionForFinding(f, reviewDecisions)}
      reviewDecisions={reviewDecisions}
      onClick={() => onFindingClick(f)}
      onSelectCandidate={onSelectCandidate}
      onReviewDecision={onReviewDecision}
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
        moduleIds={allModuleIds}
        moduleNames={allModuleNames}
        categories={categories}
        totalCount={totalDisplayCount}
        filteredCount={filteredDisplayCount}
        countLabel={countLabel}
        reviewDecisions={reviewDecisions}
        visibleFindings={displayFindings}
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
            {groupedModuleList.map((mod) => {
              const { module_id, module_name, triggered, not_applicable_reason, findings: mFindings } = mod;
              return (
                <ModuleSection
                  key={module_id}
                  moduleId={module_id}
                  moduleName={module_name}
                  findings={mFindings}
                  summaryText={buildModuleSummary({
                    triggered: triggered !== false,
                    findings: mFindings,
                    not_applicable_reason,
                  })}
                  triggered={triggered !== false}
                  notApplicableReason={not_applicable_reason}
                  matchResults={matchResults}
                  activeFindingId={activeFindingId}
                  reviewDecisions={reviewDecisions}
                  onFindingClick={onFindingClick}
                  onSelectCandidate={onSelectCandidate}
                  onReviewDecision={onReviewDecision}
                />
              );
            })}
            {groupedModuleList.length === 0 && unresolvedFindings.length === 0 && (
              <div className="sidebar__empty">No findings match the current filters.</div>
            )}
            {renderUnresolvedSection()}
          </div>
        )}

        {/* ── Overall Reasoning tab (always flat) ─────────────────────────── */}
        {!isRules && viewMode === 'flat' && (
          <div className="sidebar__flat-list">
            {resolvedFindings.map(renderCard)}
            {filtered.length === 0 && (
              <div className="sidebar__empty">No reasoning flags match the current filters.</div>
            )}
            {renderUnresolvedSection()}
          </div>
        )}

        {!isRules && viewMode === 'grouped' && (
          <div className="sidebar__grouped-list">
            {groupedFlagList.map((group) => (
              <ModuleSection
                key={group.category}
                moduleId={group.category === 'CLEAR' ? 'RF' : 'RF'}
                moduleName={group.label}
                findings={group.findings}
                matchResults={matchResults}
                activeFindingId={activeFindingId}
                reviewDecisions={reviewDecisions}
                onFindingClick={onFindingClick}
                onSelectCandidate={onSelectCandidate}
                onReviewDecision={onReviewDecision}
              />
            ))}
            {groupedFlagList.length === 0 && unresolvedFindings.length === 0 && (
              <div className="sidebar__empty">No reasoning flags match the current filters.</div>
            )}
            {renderUnresolvedSection()}
          </div>
        )}
      </div>
    </aside>
  );
};
