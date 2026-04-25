import React from 'react';
import type { MatchResult, TextRect } from '../types';

interface HighlightLayerProps {
  pageNumber: number;
  matchResults: Map<string, MatchResult>;
  activeFindingId: string | null;
  scale: number;
  extractionScale: number;
  onHighlightClick: (findingId: string) => void;
  severityMap?: Map<string, string>;
  statusMap?: Map<string, string>;
}

function scaleRect(rect: TextRect, ratio: number): TextRect {
  return {
    x: rect.x * ratio,
    y: rect.y * ratio,
    width: rect.width * ratio,
    height: rect.height * ratio,
  };
}

/**
 * Returns fill / border / shadow for a highlight box.
 *
 * Non-active:  extremely subtle yellow tint — just enough to mark the span
 *              without making the page look washed.
 * Active:      prominent, colour-coded by finding status so the type of issue
 *              is immediately clear at a glance.
 */
function highlightStyle(
  status: string,
  isActive: boolean,
): { bg: string; border: string; shadow: string } {
  if (!isActive) {
    return {
      bg:     'rgba(253, 224, 71, 0.07)',
      border: '1px solid rgba(253, 224, 71, 0.15)',
      shadow: 'none',
    };
  }

  // Active — colour by status
  if (status === 'Absent' || status === 'Insufficient') {
    return {
      bg:     'rgba(251, 191, 36, 0.52)',
      border: '2px solid rgba(217, 119, 6, 0.85)',
      shadow: '0 0 0 1px rgba(217, 119, 6, 0.30)',
    };
  }
  if (status === 'Flag') {
    // Reasoning flags — indigo/violet
    return {
      bg:     'rgba(167, 139, 250, 0.45)',
      border: '2px solid rgba(124, 58, 237, 0.80)',
      shadow: '0 0 0 1px rgba(124, 58, 237, 0.25)',
    };
  }
  if (status === 'Present') {
    return {
      bg:     'rgba(74, 222, 128, 0.45)',
      border: '2px solid rgba(22, 163, 74, 0.75)',
      shadow: '0 0 0 1px rgba(22, 163, 74, 0.25)',
    };
  }
  // Not Applicable or unknown — neutral blue
  return {
    bg:     'rgba(147, 197, 253, 0.40)',
    border: '2px solid rgba(59, 130, 246, 0.70)',
    shadow: '0 0 0 1px rgba(59, 130, 246, 0.20)',
  };
}

export const HighlightLayer: React.FC<HighlightLayerProps> = ({
  pageNumber,
  matchResults,
  activeFindingId,
  scale,
  extractionScale,
  onHighlightClick,
  statusMap,
}) => {
  const scaleRatio = scale / extractionScale;

  type Box = {
    findingId: string;
    rect: TextRect;
    isActive: boolean;
    status: string;
  };

  // Collect all boxes, rendering inactive ones first so the active box always
  // paints on top when findings overlap.
  const inactive: Box[] = [];
  const active: Box[] = [];

  matchResults.forEach((result, findingId) => {
    if (result.status !== 'matched' && result.status !== 'ambiguous') return;
    const candidate = result.candidates[result.selectedCandidateIndex];
    if (!candidate || candidate.page !== pageNumber) return;

    const status = statusMap?.get(findingId) ?? '';
    const isActive = findingId === activeFindingId;

    for (const rect of candidate.rects) {
      const box: Box = {
        findingId,
        rect: scaleRect(rect, scaleRatio),
        isActive,
        status,
      };
      if (isActive) active.push(box);
      else inactive.push(box);
    }
  });

  const allBoxes = [...inactive, ...active];
  if (allBoxes.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      {allBoxes.map((box, i) => {
        const { bg, border, shadow } = highlightStyle(box.status, box.isActive);
        return (
          <div
            key={`${box.findingId}-${i}`}
            data-highlight-id={box.findingId}
            onClick={(e) => {
              e.stopPropagation();
              onHighlightClick(box.findingId);
            }}
            style={{
              position: 'absolute',
              left: box.rect.x,
              top: box.rect.y,
              width: Math.max(box.rect.width, 8),
              height: Math.max(box.rect.height, 8),
              backgroundColor: bg,
              border,
              borderRadius: 2,
              pointerEvents: 'auto',
              cursor: 'pointer',
              boxShadow: shadow,
              transition: 'background-color 0.15s, border-color 0.15s, box-shadow 0.15s',
            }}
          />
        );
      })}
    </div>
  );
};
