import type { TextItem, TextRect } from '../types';

// ─── Text normalisation ───────────────────────────────────────────────────────

export function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\u00a0/g, ' ')          // non-breaking space
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Rect from a text item ────────────────────────────────────────────────────

/**
 * Convert a PDF.js TextItem's transform to a TextRect at the given scale.
 *
 * PDF coordinate system: origin bottom-left, Y increases upward.
 * Screen coordinate system: origin top-left, Y increases downward.
 *
 * transform = [a, b, c, d, tx, ty]
 *   tx, ty  = translation (position of text baseline in PDF user space)
 *   a, d    = scale components (a = horizontal scale / glyph width factor)
 *
 * With default viewport (no rotation):
 *   screen_x = tx * scale
 *   screen_y = viewportHeight - ty * scale   (flip Y)
 *   text starts at baseline; box top = screen_y - lineHeight
 */
export function itemToRect(
  item: TextItem,
  scale: number,
  viewportHeight: number,
): TextRect {
  const tx = item.transform[4];
  const ty = item.transform[5];

  // Font size / height: prefer item.height, fall back to |transform[3]|
  const rawHeight = Math.abs(item.height) > 0.5
    ? Math.abs(item.height)
    : Math.abs(item.transform[3]);

  const x = tx * scale;
  const baselineY = viewportHeight - ty * scale;
  const h = rawHeight * scale;
  const w = Math.abs(item.width) * scale;

  return {
    x: Math.round(x),
    y: Math.round(baselineY - h),
    width: Math.round(Math.max(w, 4)),
    height: Math.round(Math.max(h, 10)),
  };
}

// ─── Sentence boundary detection ─────────────────────────────────────────────

function findSentenceBounds(
  fullText: string,
  matchStart: number,
  matchEnd: number,
): { sentenceStart: number; sentenceEnd: number } {
  // Build sentence boundaries across the whole text once per call.
  // A sentence ends at `.`, `!`, or `?` followed by a space (or end of
  // string), provided the character before the punctuation is NOT a digit.
  type Sentence = { start: number; end: number };
  const sentences: Sentence[] = [];
  const n = fullText.length;
  let currentStart = 0;

  for (let i = 0; i < n; i++) {
    const ch = fullText[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      const before = i > 0 ? fullText[i - 1] : '';
      const after = i + 1 < n ? fullText[i + 1] : '';
      // Skip decimal numbers like "3.5".
      if (/\d/.test(before)) continue;
      if (after === ' ' || after === '' || i + 1 === n) {
        const end = i + 1;
        sentences.push({ start: currentStart, end });
        currentStart = end;
        // Skip any spaces at the start of the next sentence.
        while (currentStart < n && fullText[currentStart] === ' ') {
          currentStart++;
        }
      }
    }
  }

  if (currentStart < n) {
    sentences.push({ start: currentStart, end: n });
  }

  const matchCenter = (matchStart + matchEnd) / 2;
  const containing = sentences.find(
    (s) => matchCenter >= s.start && matchCenter <= s.end,
  );

  if (!containing) {
    return { sentenceStart: matchStart, sentenceEnd: matchEnd };
  }

  return { sentenceStart: containing.start, sentenceEnd: containing.end };
}

// ─── Core matching ────────────────────────────────────────────────────────────

export interface TextMatchSpan {
  rects: TextRect[];
  itemIndices: number[];
  matchStart: number; // char offset of anchor in concat string (for disambiguation)
}

/**
 * Find all occurrences of anchorPhrase in the page's text items, expanding
 * each match to the full enclosing sentence boundary.
 *
 * Strategy:
 *  1. Concatenate all non-empty items into a single normalised string with a
 *     char-to-item mapping.
 *  2. Find every occurrence of the anchor phrase with indexOf.
 *  3. For each occurrence, call findSentenceBounds to expand to the containing
 *     sentence (or sentence group if the anchor spans multiple sentences).
 *  4. Collect all items that overlap the expanded range and compute their rects.
 *
 * The resulting rects cover the full sentence(s). mergeRects then reduces them
 * to one rect per visual line, giving clean sentence-level highlight boxes.
 */
export function matchAnchorInPage(
  items: TextItem[],
  anchorPhrase: string,
  scale: number,
  viewportHeight: number,
): TextMatchSpan[] {
  if (!anchorPhrase?.trim() || items.length === 0) return [];

  const normAnchor = normalizeText(anchorPhrase);
  if (!normAnchor) return [];

  // Build per-part data with char offsets into the joined string
  type Part = { normText: string; itemIndex: number; charStart: number; charEnd: number };
  const parts: Part[] = [];
  let cursor = 0;

  for (let i = 0; i < items.length; i++) {
    const norm = normalizeText(items[i].str);
    if (!norm) continue;
    parts.push({
      normText: norm,
      itemIndex: i,
      charStart: cursor,
      charEnd: cursor + norm.length,
    });
    cursor += norm.length + 1; // +1 for the joining space
  }

  const fullText = parts.map((p) => p.normText).join(' ');
  const results: TextMatchSpan[] = [];

  let searchFrom = 0;
  while (searchFrom < fullText.length) {
    const matchIdx = fullText.indexOf(normAnchor, searchFrom);
    if (matchIdx === -1) break;

    const matchEnd = matchIdx + normAnchor.length;

    // Expand match to full sentence boundaries
    const { sentenceStart, sentenceEnd } = findSentenceBounds(
      fullText,
      matchIdx,
      matchEnd,
    );

    // Collect parts that overlap with [sentenceStart, sentenceEnd)
    const coveredItemIndices: number[] = [];
    for (const part of parts) {
      if (part.charEnd > sentenceStart && part.charStart < sentenceEnd) {
        coveredItemIndices.push(part.itemIndex);
      }
    }

    if (coveredItemIndices.length > 0) {
      const rects = coveredItemIndices.map((idx) =>
        itemToRect(items[idx], scale, viewportHeight),
      );
      results.push({ rects, itemIndices: coveredItemIndices, matchStart: matchIdx });
    }

    // Advance past current match (allow overlapping by +1)
    searchFrom = matchIdx + 1;
  }

  return results;
}

// ─── Rect merging ─────────────────────────────────────────────────────────────

/**
 * Merge horizontally adjacent rects on the same text line into fewer rects.
 * After sentence expansion a span covers many items; merging by Y coordinate
 * produces one clean rect per visual line — exactly what we want for
 * sentence-level highlights.
 */
export function mergeRects(rects: TextRect[], lineThreshold = 6): TextRect[] {
  if (rects.length <= 1) return rects;

  // Sort by y then x
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: TextRect[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    // Same line if y coords are close
    if (Math.abs(r.y - current.y) <= lineThreshold) {
      const right = Math.max(current.x + current.width, r.x + r.width);
      current.x = Math.min(current.x, r.x);
      current.width = right - current.x;
      current.height = Math.max(current.height, r.height);
    } else {
      merged.push(current);
      current = { ...r };
    }
  }
  merged.push(current);
  return merged;
}
