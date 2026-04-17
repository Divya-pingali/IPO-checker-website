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
 * Load and normalise a checker JSON from a URL.
 * Generic — works with any JSON file that follows the standard schema.
 */
export function useFindingsParser(jsonUrl: string): UseFindingsParserResult {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [meta, setMeta] = useState<CheckerJson['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jsonUrl) return;
    setLoading(true);
    setError(null);

    fetch(jsonUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${jsonUrl}`);
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
  }, [jsonUrl]);

  return { findings, meta, loading, error };
}
