'use client';

import { useEffect } from 'react';

/**
 * Step 7 — registers the installable app's service worker (`public/sw.js`). Production only: in
 * development it would cache pages under hot reload and serve stale code.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}
