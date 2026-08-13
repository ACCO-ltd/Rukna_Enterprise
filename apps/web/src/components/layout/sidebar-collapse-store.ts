'use client';

const STORAGE_KEY = 'rukna.sidebar.collapsed';
const listeners = new Set<() => void>();
let cache: boolean | null = null;

function load(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function applyWidth(collapsed: boolean): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--sidebar-width', collapsed ? '5rem' : '17rem');
  }
}

export const sidebarCollapseStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot(): boolean {
    cache ??= load();
    applyWidth(cache);
    return cache;
  },

  getServerSnapshot(): boolean {
    return false;
  },

  toggle(): void {
    const next = !sidebarCollapseStore.getSnapshot();
    cache = next;
    applyWidth(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // The in-memory preference remains available for this session.
    }
    listeners.forEach((listener) => listener());
  },
};
