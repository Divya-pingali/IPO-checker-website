import { useState, useEffect, useCallback, useRef } from 'react';
import type { PDFDocumentProxy } from './usePdfDocument';
import type { Finding, MatchResult, MatchStatus, PageTextData, MatchCandidate } from '../types';
import { matchAnchorInPage, mergeRects } from '../utils/textMatcher';

interface UsePdfAnchorMatcherResult {
  matchResults: Map<string, MatchResult>;
  pageTextData: Map<number, PageTextData>;
  extractionProgress: number; // 0–1
  selectCandidate: (findingId: string, index: number) => void;
}

const EXTRACT_SCALE = 1.0; // normalised scale for text extraction

/**
 * For every finding with a page + anchorPhrase, extract text from that page
 * and try to locate the anchor phrase.  Runs page-by-page in the background
 * to avoid blocking the main thread.
 */
export function usePdfAnchorMatcher(
  pdfDoc: PDFDocumentProxy | null,
  findings: Finding[],
): UsePdfAnchorMatcherResult {
  const [matchResults, setMatchResults] = useState<Map<string, MatchResult>>(new Map());
  const [pageTextData, setPageTextData] = useState<Map<number, PageTextData>>(new Map());
  const [extractionProgress, setExtractionProgress] = useState(0);

  // Track running extraction so we can cancel on new PDF load
  const cancelRef = useRef(false);

  // Stable setter helpers
  const updateMatch = useCallback(
    (findingId: string, result: MatchResult) => {
      setMatchResults((prev) => {
        const next = new Map(prev);
        next.set(findingId, result);
        return next;
      });
    },
    [],
  );

  const selectCandidate = useCallback((findingId: string, index: number) => {
    setMatchResults((prev) => {
      const existing = prev.get(findingId);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(findingId, {
        ...existing,
        selectedCandidateIndex: index,
        status: 'matched',
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!pdfDoc || findings.length === 0) return;

    cancelRef.current = false;
    setMatchResults(new Map());
    setPageTextData(new Map());
    setExtractionProgress(0);

    // Build a map of page → findings that need text extraction on that page
    const pageToFindings = new Map<number, Finding[]>();
    for (const f of findings) {
      if (!f.page) continue;
      for (const anchor of f.sourceAnchors) {
        if (anchor.page) {
          if (!pageToFindings.has(anchor.page)) pageToFindings.set(anchor.page, []);
          pageToFindings.get(anchor.page)!.push(f);
        }
      }
      // Also include primary page if not in sourceAnchors
      if (f.page && !pageToFindings.has(f.page)) {
        pageToFindings.set(f.page, [f]);
      }
    }

    // Seed no_anchor / no_page results immediately
    const initialResults = new Map<string, MatchResult>();
    for (const f of findings) {
      let status: MatchStatus = 'no_anchor';
      if (f.page === null) status = 'no_page';
      else if (!f.anchorText) status = 'no_anchor';
      else status = 'unresolved'; // will be resolved during extraction
      initialResults.set(f.id, {
        findingId: f.id,
        status,
        selectedCandidateIndex: 0,
        candidates: [],
      });
    }
    setMatchResults(initialResults);

    const pages = [...pageToFindings.keys()].sort((a, b) => a - b);
    const total = pages.length;

    // Process pages sequentially with yielding between each to keep UI responsive
    let done = 0;

    async function processPage(pageNum: number) {
      if (cancelRef.current) return;

      try {
        const page = await pdfDoc!.getPage(pageNum);
        const viewport = page.getViewport({ scale: EXTRACT_SCALE });
        const textContent = await page.getTextContent();

        if (cancelRef.current) return;

        // Store the raw text items for this page
        const rawItems = textContent.items as Array<{
          str: string;
          transform: number[];
          width: number;
          height: number;
          fontName?: string;
        }>;

        const pageData: PageTextData = {
          pageNumber: pageNum,
          items: rawItems,
          viewportHeight: viewport.height,
        };

        setPageTextData((prev) => {
          const next = new Map(prev);
          next.set(pageNum, pageData);
          return next;
        });

        // Match anchors for findings that reference this page
        const relevantFindings = pageToFindings.get(pageNum) ?? [];
        for (const f of relevantFindings) {
          if (cancelRef.current) return;

          const anchorsOnThisPage = f.sourceAnchors.filter(
            (a) => a.page === pageNum && a.anchor_phrase,
          );
          if (anchorsOnThisPage.length === 0 && f.page !== pageNum) continue;

          const anchorToTry = anchorsOnThisPage[0] ?? (f.page === pageNum ? { anchor_phrase: f.anchorText, page: pageNum } : null);
          if (!anchorToTry?.anchor_phrase) continue;

          const spans = matchAnchorInPage(
            rawItems,
            anchorToTry.anchor_phrase,
            EXTRACT_SCALE,
            viewport.height,
            viewport.transform,
          );

          const anchorIndex = f.sourceAnchors.findIndex((a) => a === anchorsOnThisPage[0]);

          if (spans.length === 0) {
            // Keep as unresolved — don't overwrite if already matched on another anchor
            setMatchResults((prev) => {
              const existing = prev.get(f.id);
              if (!existing || existing.status === 'matched') return prev;
              const next = new Map(prev);
              next.set(f.id, { ...existing, status: 'unresolved' });
              return next;
            });
          } else {
            const candidates: MatchCandidate[] = spans.map((s) => ({
              page: pageNum,
              rects: mergeRects(s.rects),
              anchorIndex: Math.max(0, anchorIndex),
            }));
            const status: MatchStatus = candidates.length === 1 ? 'matched' : 'ambiguous';
            updateMatch(f.id, {
              findingId: f.id,
              status,
              selectedCandidateIndex: 0,
              candidates,
            });
          }

          // Log to console for debugging
          console.log(
            `[matcher] ${f.id} page=${pageNum} anchor="${anchorToTry.anchor_phrase?.slice(0, 50)}"`,
            spans.length > 0 ? `→ ${spans.length} match(es)` : '→ UNRESOLVED',
          );
        }
      } catch (err) {
        console.warn(`[matcher] Failed to process page ${pageNum}:`, err);
      }

      done++;
      setExtractionProgress(done / total);
    }

    // Yield between pages using a micro-queue
    async function runAll() {
      for (const pageNum of pages) {
        if (cancelRef.current) break;
        await processPage(pageNum);
        // yield to the event loop
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    runAll();

    return () => {
      cancelRef.current = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, findings]);

  return { matchResults, pageTextData, extractionProgress, selectCandidate };
}
