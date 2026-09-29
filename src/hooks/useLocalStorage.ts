import { useState, useCallback } from 'react';

/**
 * Hook to synchronize a state variable with localStorage
 */
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      if (item === null) return defaultValue;
      return JSON.parse(item);
    } catch {
      return defaultValue;
    }
  });

  const setStoredState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const nextValue = value instanceof Function ? value(prev) : value;
        try {
          localStorage.setItem(key, JSON.stringify(nextValue));
        } catch {}
        return nextValue;
      });
    },
    [key]
  );

  return [state, setStoredState];
}

/**
 * Specialized boolean hook with automatic toggle function
 */
export function useLocalStorageBoolean(
  key: string,
  defaultValue: boolean = true
): [boolean, (val?: boolean) => void, () => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved !== null ? saved === 'true' : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setBoolean = useCallback(
    (val?: boolean) => {
      setValue((prev) => {
        const next = val !== undefined ? val : !prev;
        try {
          localStorage.setItem(key, String(next));
        } catch {}
        return next;
      });
    },
    [key]
  );

  const toggle = useCallback(() => setBoolean(), [setBoolean]);

  return [value, setBoolean, toggle];
}
