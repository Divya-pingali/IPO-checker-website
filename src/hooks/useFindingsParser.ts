import { useState, useEffect } from 'react';
import type { CheckerJson, Finding } from '../types';
import { normalizeFindings } from '../utils/normalizeFindings';

interface UseFindingsParserResult {
  findings: Finding[];
  meta: CheckerJson['meta'] | null;
  loading: boolean;
  error: string | null;
}

/**
 * Load and normalise a checker JSON.
 *
 * Accepts either:
 *   - a URL string → fetched via HTTP (original behaviour)
 *   - a CheckerJson object → normalised directly without a network request
 *   - null / '' → idle; returns empty state
 */
export function useFindingsParser(
  source: string | CheckerJson | null,
): UseFindingsParserResult {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [meta, setMeta] = useState<CheckerJson['meta'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source) {
      setFindings([]);
      setMeta(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Raw object — normalise directly, no fetch needed
    if (typeof source === 'object') {
      try {
        setLoading(true);
        setError(null);
        setMeta(source.meta ?? null);
        setFindings(normalizeFindings(source));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
      return;
    }

    // URL string — fetch
    setLoading(true);
    setError(null);
    fetch(source)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${source}`);
        return res.json() as Promise<CheckerJson>;
      })
      .then((json) => {
        setMeta(json.meta ?? null);
        setFindings(normalizeFindings(json));
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [source]);

  return { findings, meta, loading, error };
}
