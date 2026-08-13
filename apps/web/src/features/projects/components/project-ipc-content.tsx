'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, Button } from '@erp/ui';
import { IpaStatus } from '@erp/types';

import { formatDate } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';
import { isOperationalClientContract } from '@/features/contracts/contract-eligibility';
import { useContracts } from '@/features/contracts/hooks/use-contracts';
import { IpaStatusBadge } from '@/features/ipa/components/ipa-status-badge';
import { useIpasByProject } from '@/features/ipa/hooks/use-ipa';
import { IpcEffectiveBadge, IpcStatusBadge } from '@/features/ipc/components/ipc-status-badge';
import { useIpcsByProject } from '@/features/ipc/hooks/use-ipc';

export function ProjectIpcContent({ projectId }: { projectId: string }) {
  const t = useTranslations('platform.projects.ipc');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();
  const contracts = useContracts(projectId);
  const ipas = useIpasByProject(projectId);
  const ipcs = useIpcsByProject(projectId);

  const operationalContracts = contracts.data?.filter(isOperationalClientContract) ?? [];
  const contractNumberMap = new Map(
    (contracts.data ?? []).map((contract) => [contract.id, contract.contractNumber]),
  );
  const certificatesByApplication = new Map<string, NonNullable<typeof ipcs.data>>();
  for (const certificate of ipcs.data ?? []) {
    const certificates = certificatesByApplication.get(certificate.applicationId) ?? [];
    certificates.push(certificate);
    certificatesByApplication.set(certificate.applicationId, certificates);
  }

  const firstContractId = operationalContracts[0]?.id ?? null;
  const canCreateApplication = can('create:ipa') && firstContractId !== null;
  const canIssueCertificate = can('issue:ipc');
  const isLoading = contracts.isPending || ipas.isPending || ipcs.isPending;
  const isError = contracts.isError || ipas.isError || ipcs.isError;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
        {canCreateApplication ? (
          <Button size="sm" asChild>
            <Link href={`/contracts/${firstContractId}/applications/new`}>
              {t('newApplication')}
            </Link>
          </Button>
        ) : null}
      </div>

      {!canCreateApplication && !isLoading && !isError && firstContractId === null ? (
        <Alert variant="warning" messages={[t('noContract'), t('noContractHint')]} />
      ) : null}

      {isLoading ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div
            className="h-24 animate-pulse rounded-lg border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : (ipas.data?.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow-panel)]">
          {ipas.data!.map((ipa) => {
            const periodFrom = formatDate(ipa.periodFrom, locale);
            const periodTo = formatDate(ipa.periodTo, locale);
            const certificates = certificatesByApplication.get(ipa.id) ?? [];
            const hasEffectiveCertificate = certificates.some(
              (certificate) => certificate.isEffective,
            );
            const showIssueAction = canIssueCertificate && ipa.status === IpaStatus.SUBMITTED;

            return (
              <li key={ipa.id} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/contracts/${ipa.contractId}/applications/${ipa.id}`}
                        className="font-mono text-xs font-semibold text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
                      >
                        {ipa.applicationRef ?? t('unnumbered')}
                      </Link>
                      <IpaStatusBadge status={ipa.status} />
                      {contractNumberMap.get(ipa.contractId) ? (
                        <Badge tone="neutral">{contractNumberMap.get(ipa.contractId)}</Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {periodFrom && periodTo
                        ? `${periodFrom} - ${periodTo}`
                        : (periodFrom ?? periodTo ?? t('noPeriod'))}
                    </p>
                  </div>
                  {showIssueAction ? (
                    <Button
                      size="sm"
                      variant={hasEffectiveCertificate ? 'outline' : 'default'}
                      asChild
                    >
                      <Link
                        href={`/contracts/${ipa.contractId}/applications/${ipa.id}/certificates/new`}
                      >
                        {hasEffectiveCertificate
                          ? t('supersedeCertificate')
                          : t('issueCertificate')}
                      </Link>
                    </Button>
                  ) : null}
                </div>

                <div className="mt-3 border-s border-border ps-3">
                  {certificates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('noCertificates')}</p>
                  ) : (
                    <ul className="space-y-2">
                      {certificates.map((certificate) => (
                        <li
                          key={certificate.id}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/contracts/${ipa.contractId}/applications/${ipa.id}/certificates/${certificate.id}`}
                              className="text-xs font-semibold text-foreground hover:text-brand-primary hover:underline"
                            >
                              {certificate.certificateRef ?? `#${certificate.certificateNumber}`}
                            </Link>
                            <IpcStatusBadge status={certificate.status} />
                            <IpcEffectiveBadge isEffective={certificate.isEffective} />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {certificate.certifiedTotal} {certificate.currency}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
