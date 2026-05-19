import { useState, useRef, useCallback, useEffect } from 'react';

interface UseResizablePanelsOptions {
  defaultSidebarWidth?: number;
  minSidebarWidth?: number;
  maxSidebarWidth?: number;
  resetKey?: unknown;
}

interface UseResizablePanelsResult {
  sidebarWidth: number;
  isDragging: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Manages the width of the right sidebar panel.
 * Attach handleMouseDown to the drag-handle element.
 * isDragging is exposed so the drag handle can show an active cursor.
 */
export function useResizablePanels({
  defaultSidebarWidth = 420,
  minSidebarWidth = 280,
  maxSidebarWidth = 720,
  resetKey,
}: UseResizablePanelsOptions = {}): UseResizablePanelsResult {
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [isDragging, setIsDragging] = useState(false);

  const dragging = useRef(false);
  const hasUserResized = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(defaultSidebarWidth);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;
    hasUserResized.current = true;
    setIsDragging(true);
    e.preventDefault();
  }, [sidebarWidth]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    // Drag left = enlarge sidebar, drag right = shrink sidebar
    const delta = startX.current - e.clientX;
    const next = Math.min(
      maxSidebarWidth,
      Math.max(minSidebarWidth, startWidth.current + delta),
    );
    setSidebarWidth(next);
  }, [minSidebarWidth, maxSidebarWidth]);

  const handleMouseUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    if (hasUserResized.current) return;
    setSidebarWidth(defaultSidebarWidth);
    startWidth.current = defaultSidebarWidth;
  }, [defaultSidebarWidth]);

  useEffect(() => {
    hasUserResized.current = false;
    setSidebarWidth(defaultSidebarWidth);
    startWidth.current = defaultSidebarWidth;
  }, [resetKey]);

  return { sidebarWidth, isDragging, handleMouseDown };
}
