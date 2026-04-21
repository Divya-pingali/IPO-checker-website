import React, { useState } from 'react';
import type { Finding, MatchResult } from '../types';

interface FindingCardProps {
  finding: Finding;
  matchResult: MatchResult | undefined;
  isActive: boolean;
  onClick: () => void;
  onSelectCandidate?: (findingId: string, index: number) => void;
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
  L: 'Language Quality',
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

export const FindingCard: React.FC<FindingCardProps> = ({
  finding,
  matchResult,
  isActive,
  onClick,
  onSelectCandidate,
}) => {
  const [expanded, setExpanded] = useState(false);

  const matchStatus = matchResult?.status ?? 'unresolved';
  const candidates = matchResult?.candidates ?? [];
  const selectedIdx = matchResult?.selectedCandidateIndex ?? 0;

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  return (
    <div
      className={`finding-card ${isActive ? 'finding-card--active' : ''} finding-card--${matchStatus}`}
      data-finding-id={finding.id}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      {/* Header row */}
      <div className="finding-card__header">
        <span className="finding-card__id">{finding.ruleId}</span>
        <span className={`badge ${SEVERITY_CLASS[finding.severity] ?? 'badge--medium'}`}>
          {finding.severity}
        </span>
        <span className={`badge ${STATUS_CLASS[finding.status] ?? 'badge--na'}`}>
          {finding.status}
        </span>
        <span
          className={`finding-card__match-indicator match-${matchStatus}`}
          title={MATCH_TITLE[matchStatus]}
        >
          {MATCH_ICONS[matchStatus]}
        </span>
      </div>

      {/* Check type badges */}
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

      {/* Title */}
      <div className="finding-card__title">{finding.title}</div>

      {/* Module + page */}
      <div className="finding-card__meta">
        <span className="finding-card__module">{finding.moduleName}</span>
        {finding.page && (
          <span className="finding-card__page">p.{finding.page}</span>
        )}
      </div>

      {/* Summary */}
      <div className="finding-card__summary">{finding.summary}</div>

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

      {/* Expand toggle */}
      <button
        className="finding-card__expand-btn"
        onClick={toggleExpand}
      >
        {expanded ? 'Hide detail ▲' : 'Show detail ▼'}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="finding-card__detail">
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
              <blockquote className="finding-card__anchor-quote">
                {finding.anchorText}
              </blockquote>
            </div>
          )}
          {finding.sourceFile && (
            <div className="finding-card__detail-section">
              <strong>Source</strong>
              <code>{finding.sourceFile}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
