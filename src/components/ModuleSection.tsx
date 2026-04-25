import React, { useEffect, useMemo, useState } from 'react';
import type { Finding, MatchResult, ReviewDecision } from '../types';
import { sortFindings } from '../utils/normalizeFindings';
import { getReviewDecisionForFinding } from '../utils/reviewState';
import { FindingCard } from './FindingCard';

interface ModuleSectionProps {
  moduleId: string;
  moduleName: string;
  findings: Finding[];
  matchResults: Map<string, MatchResult>;
  activeFindingId: string | null;
  reviewDecisions: Record<string, ReviewDecision>;
  onFindingClick: (finding: Finding) => void;
  onSelectCandidate: (findingId: string, index: number) => void;
  onReviewDecision: (decisionKey: string, decision: ReviewDecision | null) => void;
  triggered?: boolean;
  notApplicableReason?: string;
  summaryText?: string;
}

export const ModuleSection: React.FC<ModuleSectionProps> = ({
  moduleId,
  moduleName,
  findings,
  matchResults,
  activeFindingId,
  reviewDecisions,
  onFindingClick,
  onSelectCandidate,
  onReviewDecision,
  triggered = true,
  notApplicableReason,
  summaryText,
}) => {
  const hasRules = findings.length > 0;
  const issuedFindings = useMemo(
    () => findings.filter((f) => f.status !== 'Present' && f.status !== 'Not Applicable'),
    [findings],
  );
  const hasIssues = issuedFindings.length > 0;
  const [collapsed, setCollapsed] = useState(!hasIssues);

  useEffect(() => {
    setCollapsed(!hasIssues);
  }, [hasIssues, triggered]);

  const sorted = useMemo(() => sortFindings(findings), [findings]);

  const unresolvedCount = sorted.filter((f) => {
    const r = matchResults.get(f.parentFindingId ?? f.id);
    return r?.status === 'unresolved';
  }).length;
  const reviewCounts = sorted.reduce(
    (acc, finding) => {
      const decision = getReviewDecisionForFinding(finding, reviewDecisions);
      if (decision === 'approved') acc.approved += 1;
      else if (decision === 'dismissed') acc.dismissed += 1;
      else if (decision !== null || finding.status === 'Absent' || finding.status === 'Insufficient' || finding.status === 'Flag') {
        acc.pending += 1;
      }
      return acc;
    },
    { pending: 0, approved: 0, dismissed: 0 },
  );

  const criticalCount = issuedFindings.filter((f) => f.severity === 'Critical').length;
  const absentCount = issuedFindings.filter((f) => f.status === 'Absent').length;
  const insufficientCount = issuedFindings.filter(
    (f) => f.status === 'Insufficient',
  ).length;
  const clearCount = sorted.filter((f) => f.status === 'Present').length;
  const naCount = sorted.filter((f) => f.status === 'Not Applicable').length;

  const primaryState = !triggered
    ? 'Not applicable'
    : absentCount > 0
      ? 'Missing disclosure'
      : insufficientCount > 0
        ? 'Needs detail'
        : 'Clear';

  const derivedSummary =
    summaryText ??
    (!triggered
      ? 'Module not triggered for this applicant'
      : hasIssues
        ? `${issuedFindings.length} issue${issuedFindings.length === 1 ? '' : 's'} flagged`
        : clearCount > 0
          ? `${clearCount} clear check${clearCount === 1 ? '' : 's'}`
          : 'No issues raised in this module');

  const primaryBadgeClass = !triggered
    ? 'badge--na'
    : hasIssues
      ? absentCount > 0
        ? 'badge--absent'
        : 'badge--insufficient'
      : 'badge--present';

  return (
    <div className="module-section">
      <button
        className="module-section__header"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="module-section__id">{moduleId}</span>
        <div className="module-section__title-block">
          <span className="module-section__name">{moduleName}</span>
          <span className="module-section__summary">{derivedSummary}</span>
        </div>
        <div className="module-section__stats">
          <span className={`badge badge--sm ${primaryBadgeClass}`}>{primaryState}</span>
          {!triggered && <span className="badge badge--na badge--sm">N/A</span>}
          {triggered && !hasIssues && clearCount > 0 && (
            <span className="badge badge--present badge--sm">{clearCount} clear</span>
          )}
          {triggered && hasIssues && (
            <>
              {reviewCounts.pending > 0 && (
                <span className="badge badge--sm badge--flag" title="Checks awaiting lawyer review">
                  {reviewCounts.pending} to review
                </span>
              )}
              {reviewCounts.approved > 0 && (
                <span className="badge badge--present badge--sm" title="Checks approved by lawyer">
                  {reviewCounts.approved} approved
                </span>
              )}
              {reviewCounts.dismissed > 0 && (
                <span className="badge badge--na badge--sm" title="Checks dismissed by lawyer">
                  {reviewCounts.dismissed} dismissed
                </span>
              )}
              {criticalCount > 0 && (
                <span className="badge badge--critical badge--sm" title="Critical findings">
                  {criticalCount} crit
                </span>
              )}
              {absentCount > 0 && (
                <span className="badge badge--absent badge--sm" title="Missing disclosure findings">
                  {absentCount} missing
                </span>
              )}
              {insufficientCount > 0 && (
                <span className="badge badge--insufficient badge--sm" title="Needs-detail findings">
                  {insufficientCount} needs detail
                </span>
              )}
              {unresolvedCount > 0 && (
                <span className="badge badge--na badge--sm" title="Unresolved - anchor not found in PDF">
                  {unresolvedCount} unresolved
                </span>
              )}
              <span className="module-section__count">{issuedFindings.length}</span>
            </>
          )}
          {triggered && !hasIssues && naCount > 0 && (
            <span className="badge badge--na badge--sm">{naCount} N/A</span>
          )}
        </div>
        <span className="module-section__toggle">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="module-section__findings">
          {hasRules ? (
            sorted.map((f) => (
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
            ))
          ) : (
            <div className="module-section__clear-msg">
              {triggered
                ? 'All checks passed - no issues found'
                : notApplicableReason ?? 'Module not triggered for this applicant.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
