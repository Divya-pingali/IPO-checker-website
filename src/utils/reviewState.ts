import type { Finding, ReviewDecision } from '../types';

export function isReviewableStatus(status: Finding['status']): boolean {
  return status === 'Absent' || status === 'Insufficient' || status === 'Flag';
}

export function isFindingReviewable(finding: Finding): boolean {
  return isReviewableStatus(finding.status);
}

export function getReviewDecisionKeys(finding: Finding): string[] {
  if (finding.parentFindingId) {
    return isFindingReviewable(finding) ? [finding.id] : [];
  }

  if (finding.kind === 'rule' && Array.isArray(finding.findings) && finding.findings.length > 0) {
    return finding.findings
      .filter((item) => isReviewableStatus(item.issue_type))
      .map((item, index) => `${finding.id}::${item.check_type}::${index}`);
  }

  if (!isFindingReviewable(finding)) return [];
  return [finding.id];
}

export function getReviewDecisionForFinding(
  finding: Finding,
  reviewDecisions: Record<string, ReviewDecision>,
): ReviewDecision | 'mixed' | null {
  const keys = getReviewDecisionKeys(finding);
  if (keys.length === 0) return null;

  const decisions = [...new Set(keys.map((key) => reviewDecisions[key]).filter(Boolean))];
  if (decisions.length === 0) return null;
  if (decisions.length > 1) return 'mixed';
  return decisions[0]!;
}

export function matchesReviewFilter(
  finding: Finding,
  reviewDecisions: Record<string, ReviewDecision>,
  reviewFilter: 'pending' | 'approved' | 'dismissed' | 'all',
): boolean {
  if (reviewFilter === 'all') return true;
  if (!isFindingReviewable(finding)) return false;

  const decision = getReviewDecisionForFinding(finding, reviewDecisions);
  if (reviewFilter === 'pending') return decision === null || decision === 'mixed';
  return decision === reviewFilter;
}
