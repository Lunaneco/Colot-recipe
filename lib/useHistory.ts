"use client";

import { useCallback, useState } from "react";

type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

export function useHistory<T>(initialState: T, maxEntries = 40) {
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: [],
  });

  const commit = useCallback(
    (next: T | ((current: T) => T)) => {
      setHistory((current) => {
        const resolved =
          typeof next === "function"
            ? (next as (value: T) => T)(current.present)
            : next;
        return {
          past: [
            ...current.past.slice(-(maxEntries - 1)),
            current.present,
          ],
          present: resolved,
          future: [],
        };
      });
    },
    [maxEntries],
  );

  const replace = useCallback((next: T) => {
    setHistory((current) => ({ ...current, present: next }));
  }, []);

  const reset = useCallback((next: T) => {
    setHistory({ past: [], present: next, future: [] });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      if (!current.past.length) return current;
      const previous = current.past[current.past.length - 1];
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      if (!current.future.length) return current;
      return {
        past: [...current.past, current.present],
        present: current.future[0],
        future: current.future.slice(1),
      };
    });
  }, []);

  return {
    state: history.present,
    commit,
    replace,
    reset,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
