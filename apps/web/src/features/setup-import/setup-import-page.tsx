'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn, EmptyState } from '@erp/ui';
import { PERMISSIONS, type SetupImportKind } from '@erp/types';

import { PageHeader } from '@/components/layout/page-header';
import { usePermissions } from '@/features/auth/permissions/can';

import { SetupImportWizard } from './import-wizard';

/**
 * Step 5 — `/finance/accounting/import?kind=suppliers|clients`. One tab per kind the reader may
 * import; the server applies the same rule (suppliers: Manage payables; clients: Create clients
 * or Manage receivables).
 */
export function SetupImportPage() {
  const t = useTranslations('finance.setupImport');
  const params = useSearchParams();
  const { can } = usePermissions();

  const allowed: SetupImportKind[] = [];
  if (can(PERMISSIONS.payablesManage)) allowed.push('suppliers');
  if (can(PERMISSIONS.clientsCreate) || can(PERMISSIONS.receivablesManage)) allowed.push('clients');
  const asked = params.get('kind') as SetupImportKind | null;
  const kind = asked && allowed.includes(asked) ? asked : allowed[0];

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {!kind ? (
        <EmptyState title={t('noAccessTitle')} description={t('noAccess')} />
      ) : (
        <>
          {allowed.length > 1 ? (
            <nav aria-label={t('title')} className="mb-6 flex gap-1 border-b border-border">
              {allowed.map((k) => (
                <Link
                  key={k}
                  href={`/finance/accounting/import?kind=${k}`}
                  aria-current={k === kind ? 'page' : undefined}
                  className={cn(
                    '-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-body-sm font-medium',
                    k === kind ? 'border-brand-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`tabs.${k}`)}
                </Link>
              ))}
            </nav>
          ) : null}
          {/* Keyed by kind: switching tabs starts a fresh import rather than carrying a mapping over. */}
          <SetupImportWizard key={kind} kind={kind} />
        </>
      )}
    </>
  );
}
