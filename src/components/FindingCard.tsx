import React, { useMemo, useState } from 'react';
import type { Finding, MatchResult, ReviewDecision } from '../types';
import { getReviewDecisionKeys, isFindingReviewable } from '../utils/reviewState';

interface FindingCardProps {
  finding: Finding;
  matchResult: MatchResult | undefined;
  isActive: boolean;
  reviewDecision: ReviewDecision | 'mixed' | null;
  reviewDecisions: Record<string, ReviewDecision>;
  onClick: () => void;
  onSelectCandidate?: (findingId: string, index: number) => void;
  onReviewDecision?: (decisionKey: string, decision: ReviewDecision | null) => void;
}

const SEVERITY_CLASS: Record<string, string> = {
  Critical: 'badge--critical',
  High: 'badge--high',
  Medium: 'badge--medium',
  Low: 'badge--low',
};

const STATUS_CLASS: Record<string, string> = {
  Present: 'badge--present',
  Insufficient: 'badge--insufficient',
  Absent: 'badge--absent',
  'Not Applicable': 'badge--na',
  Flag: 'badge--flag',
};

const CHECK_TYPE_LABELS: Record<string, string> = {
  D: 'Disclosure',
  T: 'Threshold',
  K: 'Consistency',
  L: 'Language',
  R: 'Reasoning',
};

const CHECK_TYPE_DESCRIPTIONS: Record<string, string> = {
  D: 'Is the required item present and specific enough?',
  T: 'Does the disclosed figure meet a quantitative requirement?',
  K: 'Does the disclosed information match other sections?',
  L: 'Is the disclosure fairly presented in plain language?',
  R: 'Does the evidence logically support the claimed conclusion?',
};

const MATCH_ICONS: Record<string, string> = {
  matched: '●',
  ambiguous: '◑',
  unresolved: '○',
  no_anchor: '—',
  no_page: '—',
};
const MATCH_TITLE: Record<string, string> = {
  matched: 'Highlighted in PDF',
  ambiguous: 'Multiple matches — select below',
  unresolved: 'Could not locate in PDF',
  no_anchor: 'No anchor phrase',
  no_page: 'No page reference',
};

function statusLabel(status: string): string {
  if (status === 'Clear') return 'Present';
  if (status === 'Needs detail') return 'Insufficient Information';
  if (status === 'Missing disclosure') return 'Absent';
  if (status === 'Insufficient') return 'Insufficient Information';
  return status;
}

export const FindingCard: React.FC<FindingCardProps> = ({
  finding,
  matchResult,
  isActive,
  reviewDecision,
  reviewDecisions,
  onClick,
  onSelectCandidate,
  onReviewDecision,
}) => {
  const [expanded, setExpanded] = useState(false);

  const matchStatus = matchResult?.status ?? 'unresolved';
  const candidates = matchResult?.candidates ?? [];
  const selectedIdx = matchResult?.selectedCandidateIndex ?? 0;

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };
  const reviewDecisionKeys = useMemo(() => getReviewDecisionKeys(finding), [finding]);
  const isReviewable = isFindingReviewable(finding);

  const applyDecision = (e: React.MouseEvent, decision: ReviewDecision | null) => {
    e.stopPropagation();
    if (!onReviewDecision) return;
    for (const key of reviewDecisionKeys) onReviewDecision(key, decision);
  };

  return (
    <div
      className={`finding-card ${isActive ? 'finding-card--active' : ''} finding-card--${matchStatus}`}
      data-finding-id={finding.parentFindingId ?? finding.id}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      {/* Row 1: [A1] Title .............. [Critical] [Insufficient Information] [●] */}
      <div className="finding-card__header">
        <span className="finding-card__id">{finding.ruleId}</span>
        <span className="finding-card__title">{finding.title}</span>
        <div className="finding-card__header-right">
          {!(finding.severity === 'Critical' && finding.status === 'Present') && (
            <span className={`badge ${SEVERITY_CLASS[finding.severity] ?? 'badge--medium'}`}>
              {finding.severity}
            </span>
          )}
          <span className={`badge ${STATUS_CLASS[finding.status] ?? 'badge--na'}`}>
            {statusLabel(finding.status)}
          </span>
          <span
            className={`finding-card__match-indicator match-${matchStatus}`}
            title={MATCH_TITLE[matchStatus]}
          >
            {MATCH_ICONS[matchStatus]}
          </span>
        </div>
      </div>

      {/* Row 2: [Independence] [p.186] */}
      <div className="finding-card__meta">
        <span className="finding-card__module">{finding.moduleName}</span>
        {finding.page && (
          <span className="finding-card__page">p.{finding.page}</span>
        )}
      </div>

      {/* Unresolved notice */}
      {matchStatus === 'unresolved' && (
        <div className="finding-card__unresolved">
          Could not locate anchor in PDF
          {finding.anchorText && (
            <em className="finding-card__anchor-text">
              "{finding.anchorText.slice(0, 80)}{finding.anchorText.length > 80 ? '…' : ''}"
            </em>
          )}
        </div>
      )}

      {/* Ambiguous: candidate picker */}
      {matchStatus === 'ambiguous' && candidates.length > 1 && onSelectCandidate && (
        <div className="finding-card__candidates" onClick={(e) => e.stopPropagation()}>
          <span className="finding-card__candidates-label">
            {candidates.length} matches — choose location:
          </span>
          <div className="finding-card__candidates-list">
            {candidates.map((c, idx) => (
              <button
                key={idx}
                className={`btn btn--sm ${selectedIdx === idx ? 'btn--active' : ''}`}
                onClick={() => onSelectCandidate(finding.id, idx)}
              >
                Match {idx + 1} (p.{c.page})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Row 3: [Disclosure][Consistency] */}
      {finding.checkTypes.length > 0 && (
        <div className="finding-card__check-types">
          {finding.checkTypes.map((code) => (
            <span
              key={code}
              className="check-type-badge"
              title={CHECK_TYPE_DESCRIPTIONS[code] ?? code}
            >
              {CHECK_TYPE_LABELS[code] ?? code}
            </span>
          ))}
        </div>
      )}

      {/* Bottom bar: expand toggle + context-aware review actions */}
      <div className="finding-card__bottom-bar">
        <button className="finding-card__expand-btn" onClick={toggleExpand}>
          {expanded ? 'Hide detail ▲' : 'Show detail ▼'}
        </button>
        {isReviewable && (
          <div className="finding-card__review-actions" onClick={(e) => e.stopPropagation()}>
            {(reviewDecision === null || reviewDecision === 'mixed') && (
              <>
                <button className="review-action review-action--approve" onClick={(e) => applyDecision(e, 'approved')}>
                  ✓ Approve
                </button>
                <button className="review-action review-action--dismiss" onClick={(e) => applyDecision(e, 'dismissed')}>
                  ✕ Dismiss
                </button>
              </>
            )}
            {reviewDecision === 'approved' && (
              <button className="review-action review-action--undo" onClick={(e) => applyDecision(e, null)}>
                ↩ Back to review
              </button>
            )}
            {reviewDecision === 'dismissed' && (
              <>
                <button className="review-action review-action--undo" onClick={(e) => applyDecision(e, null)}>
                  ↩ Restore
                </button>
                <button className="review-action review-action--delete" onClick={(e) => applyDecision(e, 'deleted')}>
                  Delete
                </button>
              </>
            )}
            {reviewDecision === 'deleted' && (
              <button className="review-action review-action--undo" onClick={(e) => applyDecision(e, null)}>
                ↩ Restore
              </button>
            )}
          </div>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="finding-card__detail">
          {finding.summary && (
            <div className="finding-card__detail-section">
              <p>{finding.summary}</p>
            </div>
          )}
          {finding.findings && finding.findings.length > 0 ? (
            finding.findings.map((f, i) => (
              <div key={i} className="finding-card__check-detail">
                  <div className="finding-card__check-detail-header">
                    <span className="check-type-badge">{CHECK_TYPE_LABELS[f.check_type] ?? f.check_type}</span>
                    <span className={`badge badge--sm ${STATUS_CLASS[f.issue_type] ?? 'badge--na'}`}>
                      {statusLabel(f.issue_type)}
                    </span>
                  </div>
                {f.explanation && (
                  <div className="finding-card__detail-section">
                    <strong>Explanation</strong>
                    <p>{f.explanation}</p>
                  </div>
                )}
                {f.recommendation && (
                  <div className="finding-card__detail-section">
                    <strong>Recommendation</strong>
                    <p>{f.recommendation}</p>
                  </div>
                )}
                {f.source_anchor?.anchor_phrase && (
                  <div className="finding-card__detail-section">
                    <strong>Source anchor</strong>
                    <blockquote className="finding-card__anchor-quote">{f.source_anchor.anchor_phrase}</blockquote>
                  </div>
                )}
                {f.source_anchor?.source_file && (
                  <div className="finding-card__detail-section">
                    <strong>Source</strong>
                    <code>{f.source_anchor.source_file}{f.source_anchor.page ? ` · p.${f.source_anchor.page}` : ''}</code>
                  </div>
                )}
              </div>
            ))
          ) : (
            <>
              {finding.explanation && (
                <div className="finding-card__detail-section">
                  <strong>Explanation</strong>
                  <p>{finding.explanation}</p>
                </div>
              )}
              {finding.recommendation && (
                <div className="finding-card__detail-section">
                  <strong>Recommendation</strong>
                  <p>{finding.recommendation}</p>
                </div>
              )}
              {finding.anchorText && (
                <div className="finding-card__detail-section">
                  <strong>Anchor phrase</strong>
                  <blockquote className="finding-card__anchor-quote">{finding.anchorText}</blockquote>
                </div>
              )}
              {finding.sourceFile && (
                <div className="finding-card__detail-section">
                  <strong>Source</strong>
                  <code>{finding.sourceFile}</code>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
