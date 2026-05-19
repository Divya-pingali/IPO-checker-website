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
  const paddingX = 2;
  return {
    x: rect.x * ratio - paddingX,
    y: rect.y * ratio + 1,
    width: rect.width * ratio + paddingX * 2,
    height: rect.height * ratio,
  };
}

function highlightStyle(isActive: boolean): { bg: string; border: string; shadow: string } {
  if (!isActive) {
    return {
      bg: 'rgba(254, 240, 138, 0.28)',
      border: '1px solid rgba(234, 179, 8, 0.28)',
      shadow: 'none',
    };
  }

  return {
    bg: 'rgba(253, 224, 71, 0.45)',
    border: '2px solid rgba(202, 138, 4, 0.55)',
    shadow: '0 0 0 1px rgba(202, 138, 4, 0.14)',
  };
}

export const HighlightLayer: React.FC<HighlightLayerProps> = ({
  pageNumber,
  matchResults,
  activeFindingId,
  scale,
  extractionScale,
  onHighlightClick,
}) => {
  const scaleRatio = scale / extractionScale;

  type Box = {
    findingId: string;
    rect: TextRect;
    isActive: boolean;
  };

  const inactive: Box[] = [];
  const active: Box[] = [];
  const inactiveKeys = new Set<string>();

  matchResults.forEach((result, findingId) => {
    if (result.status !== 'matched' && result.status !== 'ambiguous') return;
    const candidate = result.candidates[result.selectedCandidateIndex];
    if (!candidate || candidate.page !== pageNumber) return;

    const isActive = findingId === activeFindingId;

    for (const rect of candidate.rects) {
      const scaledRect = scaleRect(rect, scaleRatio);
      const box: Box = {
        findingId,
        rect: scaledRect,
        isActive,
      };

      if (isActive) {
        active.push(box);
      } else {
        const key = [
          Math.round(scaledRect.x),
          Math.round(scaledRect.y),
          Math.round(scaledRect.width),
          Math.round(scaledRect.height),
        ].join(':');
        if (!inactiveKeys.has(key)) {
          inactiveKeys.add(key);
          inactive.push(box);
        }
      }
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
        const { bg, border, shadow } = highlightStyle(box.isActive);
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
