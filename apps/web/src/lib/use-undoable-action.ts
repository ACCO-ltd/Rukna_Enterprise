'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@erp/ui';

export const UNDO_WINDOW_MS = 8000;

interface Pending {
  key: string;
  commit: () => Promise<unknown>;
  timer: number;
  toastId: number | null;
}

export interface UndoableAction {
  /** Stable id of the thing acted on — the row to hide while the window is open. */
  key: string;
  /** Toast title, past tense: "Draft invoice cancelled". */
  title: string;
  /** Second line: what it was — "Hargeisa Water Agency · $22,500.00". */
  description?: string;
  /** The server call, made only when the undo window closes. */
  commit: () => Promise<unknown>;
  /** The call failed after the window: say so (the row reappears by itself). */
  onError?: (error: unknown) => void;
}

/**
 * Undo by delay (Step 2g, ADR-047): the row goes at once and the toast offers Undo (or Z) for eight
 * seconds; only then is the command sent. Nothing is sent if Undo is pressed, so there is nothing to
 * roll back. Leaving the page sends what is pending straight away rather than dropping it.
 *
 * Use only for commands that are safe to send late (cancel a draft, delete a saved view) — never
 * for posting, payments or anything another person waits on.
 */
export function useUndoableAction(labels: { undo: string; undoneTitle: string }) {
  const { toast, dismiss } = useToast();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Map<string, Pending>());

  const show = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });

  const send = useCallback(async (entry: Pending, onError?: (e: unknown) => void) => {
    pending.current.delete(entry.key);
    try {
      await entry.commit();
    } catch (error) {
      show(entry.key);
      onError?.(error);
    }
  }, []);

  const undo = useCallback(
    (key: string) => {
      const entry = pending.current.get(key);
      if (!entry) return;
      window.clearTimeout(entry.timer);
      if (entry.toastId !== null) dismiss(entry.toastId);
      pending.current.delete(key);
      show(key);
      toast({ title: labels.undoneTitle, tone: 'success', duration: 3000 });
    },
    [dismiss, labels.undoneTitle, toast],
  );

  const run = useCallback(
    (action: UndoableAction) => {
      setHidden((current) => new Set(current).add(action.key));
      const entry: Pending = {
        key: action.key,
        commit: action.commit,
        timer: window.setTimeout(() => void send(entry, action.onError), UNDO_WINDOW_MS),
        toastId: null,
      };
      pending.current.set(action.key, entry);
      entry.toastId = toast({
        title: action.title,
        description: action.description,
        tone: 'success',
        duration: UNDO_WINDOW_MS,
        action: { label: labels.undo, onClick: () => undo(action.key) },
      });
    },
    [labels.undo, send, toast, undo],
  );

  // Z undoes the latest pending action, unless someone is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'z' || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const latest = [...pending.current.keys()].pop();
      if (latest) {
        event.preventDefault();
        undo(latest);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undo]);

  // Leaving the screen sends what is still pending — the user already chose it.
  useEffect(() => {
    const map = pending.current;
    return () => {
      for (const entry of map.values()) {
        window.clearTimeout(entry.timer);
        void entry.commit().catch(() => undefined);
      }
      map.clear();
    };
  }, []);

  return { run, undo, hidden };
}
