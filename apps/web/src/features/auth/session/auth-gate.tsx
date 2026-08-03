'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { endSession, restoreSession } from '@/lib/api-client';

import { sessionStore } from './session-store';

type GateStatus = 'checking' | 'ready';

/**
 * Establishes the session before rendering a protected subtree.
 *
 * The access token lives in memory only, so a page reload, a new tab, or a direct link
 * arrives with no token even though the user is legitimately signed in — the HttpOnly
 * refresh cookie is still valid. This calls /auth/refresh once on mount to trade that
 * cookie for a fresh access token.
 *
 * The `__auth` marker cookie lets middleware redirect before this component ever renders,
 * but the marker can be stale or forged; this gate is what actually decides.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<GateStatus>(() =>
    // Server render always reports 'checking' so hydration matches a cold client load.
    // On a soft navigation from /login the session is already in memory — no splash.
    typeof window !== 'undefined' && sessionStore.getState().isAuthenticated
      ? 'ready'
      : 'checking',
  );

  useEffect(() => {
    if (status === 'ready') return;

    let active = true;

    restoreSession()
      .then(() => {
        if (active) setStatus('ready');
      })
      .catch(() => {
        // No valid refresh cookie — clear the stale marker and send the user to login
        // with a `next` param so they return here afterwards.
        endSession();
      });

    return () => {
      active = false;
    };
  }, [status]);

  if (status === 'checking') return <SessionSplash />;

  return <>{children}</>;
}

function SessionSplash() {
  const t = useTranslations('common');

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm text-muted-foreground">{t('loading')}</p>
    </div>
  );
}
