'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@erp/ui';

import { useCanViewFinanceProjects } from '../hooks';
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
 * Client-side because the session (and so the permission) lives in the browser; `AuthGate` has
 * established it before this renders, so the decision is made once, on the first effect.
 */
export function ProjectInvoiceRedirect({ projectId, invoiceId }: { projectId: string; invoiceId: string }) {
  const t = useTranslations('finance.projects.redirect');
  const router = useRouter();
  const canViewFinance = useCanViewFinanceProjects();

  useEffect(() => {
    router.replace(projectInvoiceTarget(projectId, invoiceId, canViewFinance));
  }, [router, projectId, invoiceId, canViewFinance]);

  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{t('opening')}</span>
      <Skeleton className="h-24 w-full" aria-hidden="true" />
    </div>
  );
}
