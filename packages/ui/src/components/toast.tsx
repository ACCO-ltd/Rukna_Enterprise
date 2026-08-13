'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: 'success' | 'error' | 'warning' | 'info';
  duration?: number | null;
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions { id: number }
interface ToastContextValue { toast: (options: ToastOptions) => number; dismiss: (id: number) => void }
const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}

export function ToastProvider({ children, dismissLabel = 'Dismiss' }: { children: React.ReactNode; regionLabel?: string; dismissLabel?: string }) {
  const [items, setItems] = React.useState<ToastRecord[]>([]);
  const nextId = React.useRef(0);
  const dismiss = React.useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const toast = React.useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    setItems((current) => [...current, { ...options, id }].slice(-4));
    if (options.tone !== 'error' && options.duration !== null) window.setTimeout(() => dismiss(id), options.duration ?? 5000);
    return id;
  }, [dismiss]);
  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return <ToastContext.Provider value={value}>{children}<ToastViewport items={items} dismiss={dismiss} dismissLabel={dismissLabel} /></ToastContext.Provider>;
}

function ToastViewport({ items, dismiss, dismissLabel }: { items: ToastRecord[]; dismiss: (id: number) => void; dismissLabel: string }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<div className="fixed bottom-4 end-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">{items.map((item) => <div key={item.id} className="rounded-panel border border-border bg-surface-elevated p-4 shadow-e3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-foreground">{item.title}</p>{item.description ? <p className="mt-1 text-sm text-muted-foreground">{item.description}</p> : null}</div><button type="button" className="text-muted-foreground" aria-label={dismissLabel} onClick={() => dismiss(item.id)}>x</button></div>{item.action ? <button type="button" className="mt-3 text-sm font-semibold text-brand-primary" onClick={item.action.onClick}>{item.action.label}</button> : null}</div>)}</div>, document.body);
}
