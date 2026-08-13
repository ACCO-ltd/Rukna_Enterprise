'use client';

import { useTranslations } from 'next-intl';
import { ToastProvider as UiToastProvider } from '@erp/ui';

/**
 * Supplies the toast region its translated labels.
 *
 * `packages/ui` deliberately knows nothing about how strings are resolved — every shared
 * component takes already-translated text — so the two accessible names the toast region
 * needs are looked up here instead. This is the same arrangement `DirectionProvider` uses
 * for the resolved locale direction.
 *
 * It sits inside `NextIntlClientProvider` and outside `QueryProvider`, because a mutation
 * raising a toast is a query-layer concern and the provider it calls must already be above
 * it.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common.toast');

  return (
    <UiToastProvider regionLabel={t('regionLabel')} dismissLabel={t('dismiss')}>
      {children}
    </UiToastProvider>
  );
}
