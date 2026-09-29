import { useEffect } from 'react';

/**
 * Hook to invoke a callback when the user presses the Escape key
 * @param onEscape Callback to invoke
 * @param active Whether the listener is active (default: true)
 */
export function useEscapeKey(onEscape: () => void, active: boolean = true): void {
  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEscape();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onEscape, active]);
}
