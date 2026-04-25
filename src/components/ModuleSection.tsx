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

  const absentCount = issuedFindings.filter((f) => f.status === 'Absent').length;
  const insufficientCount = issuedFindings.filter((f) => f.status === 'Insufficient').length;
  const flagCount = issuedFindings.filter((f) => f.status === 'Flag').length;
  const clearCount = sorted.filter((f) => f.status === 'Present').length;

  const primaryState = !triggered
    ? 'Not applicable'
    : absentCount > 0
      ? 'Missing disclosure'
      : insufficientCount > 0
        ? 'Needs detail'
        : flagCount > 0
          ? 'Flagged'
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
    : absentCount > 0
      ? 'badge--absent'
      : insufficientCount > 0
        ? 'badge--insufficient'
        : flagCount > 0
          ? 'badge--flag'
          : hasIssues
            ? 'badge--insufficient'
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
        <span className={`badge badge--sm ${primaryBadgeClass}`}>{primaryState}</span>
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
