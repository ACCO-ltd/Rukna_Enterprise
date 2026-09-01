'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, FormField, Input } from '@erp/ui';
import { apiClient, ApiError } from '@/lib/api-client';
import { clearAuthMarker } from '../session/auth-cookies';
import { sessionStore } from '../session/session-store';

export function ChangeTemporaryPasswordForm() {
  const router = useRouter();
  const t = useTranslations('auth.changePassword');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 12 || password !== confirm) {
      setError(password !== confirm ? t('mismatch') : t('minimum'));
      return;
    }
    setBusy(true); setError(null);
    try {
      await apiClient<void>('/users/change-temporary-password', { method: 'POST', body: JSON.stringify({ password }) });
      sessionStore.clearSession();
      clearAuthMarker();
      router.replace('/login');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('failed'));
    } finally { setBusy(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-background p-6"><form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-panel border border-border bg-surface p-6"><div><h1 className="text-xl font-semibold text-foreground">{t('title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p></div><FormField htmlFor="password" label={t('newPassword')} error={error ?? undefined}><Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} /></FormField><FormField htmlFor="confirm" label={t('confirmPassword')}><Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} /></FormField><Button type="submit" className="w-full" disabled={busy}>{busy ? t('saving') : t('save')}</Button></form></main>;
}
