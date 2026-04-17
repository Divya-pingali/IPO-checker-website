import React, { useState, useMemo } from 'react';
import type { Finding, MatchResult } from '../types';
import { sortFindings } from '../utils/normalizeFindings';
import { FindingCard } from './FindingCard';

interface ModuleSectionProps {
  moduleId: string;
  moduleName: string;
  findings: Finding[];
  matchResults: Map<string, MatchResult>;
  activeFindingId: string | null;
  onFindingClick: (finding: Finding) => void;
  onSelectCandidate: (findingId: string, index: number) => void;
}

export const ModuleSection: React.FC<ModuleSectionProps> = ({
  moduleId,
  moduleName,
  findings,
  matchResults,
  activeFindingId,
  onFindingClick,
  onSelectCandidate,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const sorted = useMemo(() => sortFindings(findings), [findings]);

  const unresolvedCount = sorted.filter((f) => {
    const r = matchResults.get(f.id);
    return r?.status === 'unresolved';
  }).length;

  const criticalCount = sorted.filter((f) => f.severity === 'Critical').length;
  const absentCount = sorted.filter((f) => f.status === 'Absent').length;
  const insufficientCount = sorted.filter((f) => f.status === 'Insufficient').length;

  return (
    <div className="module-section">
      <button
        className="module-section__header"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="module-section__id">{moduleId}</span>
        <span className="module-section__name">{moduleName}</span>
        <div className="module-section__stats">
          {criticalCount > 0 && (
            <span className="badge badge--critical badge--sm" title="Critical findings">
              {criticalCount} crit
            </span>
          )}
          {absentCount > 0 && (
            <span className="badge badge--absent badge--sm" title="Absent findings">
              {absentCount} absent
            </span>
          )}
          {insufficientCount > 0 && (
            <span className="badge badge--insufficient badge--sm" title="Insufficient findings">
              {insufficientCount} insuff
            </span>
          )}
          {unresolvedCount > 0 && (
            <span className="badge badge--na badge--sm" title="Unresolved — anchor not found in PDF">
              {unresolvedCount} ◌
            </span>
          )}
          <span className="module-section__count">{findings.length}</span>
        </div>
        <span className="module-section__toggle">{collapsed ? '▶' : '▼'}</span>
      </button>

      {!collapsed && (
        <div className="module-section__findings">
          {sorted.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              matchResult={matchResults.get(f.id)}
              isActive={f.id === activeFindingId}
              onClick={() => onFindingClick(f)}
              onSelectCandidate={onSelectCandidate}
            />
          ))}
        </div>
      )}
    </div>
  );
};
