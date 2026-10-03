'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';

import { FINANCE_PROJECTS_PERMISSION } from '../hooks';
import { financeProjectRedirects } from '../redirects';

/** Where an old project invoice link goes for this reader (pure, so it is tested on its own). */
export function projectInvoiceTarget(projectId: string, invoiceId: string, canViewFinance: boolean): string {
  return canViewFinance
    ? financeProjectRedirects.invoice(projectId, invoiceId)
    : financeProjectRedirects.commercialSchedule(projectId);
}

/**
 * ADR-043 Phase 3 — `/projects/:id/commercial/invoices/:invoiceId` is retired. A finance reader
 * (`view:financial-position`) continues to the same invoice page, now inside Finance → Projects →
 * Billing, where every invoice command (issue, send, payment, credit note, collection notes) lives.
 * Anyone else is sent to the Commercial schedule: the stage's money-free status is what a project
 * role needs, and no invoice money or command is reachable from the project any more.
 *
 * Client-side because the session (and so the permission) lives in the browser. The decision
 * waits until the permission set is known (`ready`) — on the hydration snapshot there is no
 * session yet, and deciding then would send a finance reader to the schedule.
 */
export function ProjectInvoiceRedirect({ projectId, invoiceId }: { projectId: string; invoiceId: string }) {
  const t = useTranslations('finance.projects.redirect');
  const router = useRouter();
  const { ready, can } = usePermissions();
  const canViewFinance = can(FINANCE_PROJECTS_PERMISSION);

  useEffect(() => {
    if (!ready) return;
    router.replace(projectInvoiceTarget(projectId, invoiceId, canViewFinance));
  }, [router, projectId, invoiceId, ready, canViewFinance]);

  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{t('opening')}</span>
      <Skeleton className="h-24 w-full" aria-hidden="true" />
    </div>
  );
}
