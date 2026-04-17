import { useState, useCallback } from 'react';

interface UseRulebookReferenceResult {
  rulebookUrl: string;
  rulebookOpen: boolean;
  openRulebook: (pageHint?: number) => void;
  closeRulebook: () => void;
  rulebookPage: number;
  setRulebookPage: (page: number) => void;
}

/**
 * Manages the rulebook reference panel state.
 * The rulebook URL is treated as a first-class input but the panel is optional.
 * In future iterations this hook can be extended to parse the rulebook PDF and
 * provide metadata mapping (module names, rule descriptions, parameter values).
 */
export function useRulebookReference(url: string): UseRulebookReferenceResult {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [rulebookPage, setRulebookPage] = useState(1);

  const openRulebook = useCallback((pageHint = 1) => {
    setRulebookPage(pageHint);
    setRulebookOpen(true);
  }, []);

  const closeRulebook = useCallback(() => {
    setRulebookOpen(false);
  }, []);

  return {
    rulebookUrl: url,
    rulebookOpen,
    openRulebook,
    closeRulebook,
    rulebookPage,
    setRulebookPage,
  };
}
