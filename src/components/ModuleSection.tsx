import React, { useEffect, useMemo, useState } from 'react';
import type { Finding, MatchResult, ReviewDecision } from '../types';
import { sortFindings } from '../utils/normalizeFindings';
import { getReviewDecisionForFinding, isFindingReviewable } from '../utils/reviewState';
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
  const hasPendingReview = useMemo(
    () =>
      findings.some((finding) => {
        if (!isFindingReviewable(finding)) return false;
        const decision = getReviewDecisionForFinding(finding, reviewDecisions);
        return decision === null || decision === 'mixed';
      }),
    [findings, reviewDecisions],
  );
  const shouldExpand = hasIssues || hasPendingReview;
  const [collapsed, setCollapsed] = useState(!shouldExpand);

  useEffect(() => {
    setCollapsed(!shouldExpand);
  }, [shouldExpand, triggered]);

  const sorted = useMemo(() => sortFindings(findings), [findings]);

  const clearCount = sorted.filter((f) => f.status === 'Present').length;

  const derivedSummary =
    summaryText ??
    (!triggered
      ? 'Module not triggered for this applicant'
      : hasIssues
        ? `${issuedFindings.length} issue${issuedFindings.length === 1 ? '' : 's'} flagged`
        : clearCount > 0
          ? `${clearCount} clear check${clearCount === 1 ? '' : 's'}`
          : 'No issues raised in this module');

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
