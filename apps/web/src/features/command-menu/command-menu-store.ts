'use client';

/**
 * Open/closed state for the single, app-wide command menu.
 *
 * The menu is mounted once in the shell, but two things open it — the top-bar chip and the
 * global Cmd/Ctrl+K shortcut — and they live in different parts of the tree. A tiny external
 * store lets both drive the one instance without threading props through the shell, the same
 * `useSyncExternalStore` pattern the sidebar-collapse state already uses.
 */

import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const commandMenuStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): boolean {
    return open;
  },
  getServerSnapshot(): boolean {
    return false;
  },
  set(next: boolean): void {
    if (open === next) return;
    open = next;
    emit();
  },
  toggle(): void {
    open = !open;
    emit();
  },
};

export function useCommandMenuOpen(): boolean {
  return useSyncExternalStore(
    commandMenuStore.subscribe,
    commandMenuStore.getSnapshot,
    commandMenuStore.getServerSnapshot,
  );
}

export function openCommandMenu(): void {
  commandMenuStore.set(true);
}

export function closeCommandMenu(): void {
  commandMenuStore.set(false);
}

export function toggleCommandMenu(): void {
  commandMenuStore.toggle();
}
