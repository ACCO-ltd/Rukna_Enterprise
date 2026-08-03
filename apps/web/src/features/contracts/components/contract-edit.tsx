'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ContractStatus } from '@erp/types';
import { Alert, Button } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { useContract } from '../hooks/use-contracts';
import { ContractForm } from './contract-form';

/**
 * Loads a contract for editing and enforces the DRAFT-only rule before rendering the form.
 *
 * The API rejects a PATCH on a non-DRAFT contract with a 400. Reaching this page for a
 * contract that has moved on — via a stale tab or a bookmark — should explain that rather
 * than present a form that cannot be saved.
 */
export function ContractEdit({ id }: { id: string }) {
  const t = useTranslations('platform.contracts.detail');
  const tCommon = useTranslations('common');
  const { data: contract, isPending, isError, error } = useContract(id);

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-96 animate-pulse rounded-lg border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href="/contracts">{t('back')}</Link>
        </Button>
      </div>
    );
  }

  if (contract.status !== ContractStatus.DRAFT) {
    return (
      <div className="space-y-4">
        <Alert variant="warning" messages={[t('editOnlyDraft')]} />
        <Button variant="outline" asChild>
          <Link href={`/contracts/${id}`}>{t('back')}</Link>
        </Button>
      </div>
    );
  }

  return <ContractForm contract={contract} />;
}
