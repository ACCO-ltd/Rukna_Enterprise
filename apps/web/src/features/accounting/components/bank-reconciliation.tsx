'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  FormField,
  SectionHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

import { currentVersion } from '../account-display';
import { useAccounts, useBankAccounts, useFiscalYears, useRunReconciliation } from '../hooks/use-accounting';
import type { ControlAccountCheck } from '../types';

export function BankReconciliation() {
  const t = useTranslations('accounting.reconciliation');
  const locale = useLocale() as 'en';

  const accounts = useAccounts();
  const bankAccounts = useBankAccounts();
  const fiscalYears = useFiscalYears();
  const reconcile = useRunReconciliation();

  const [periodId, setPeriodId] = useState('');

  const arAccount = (accounts.data ?? []).find(
    (a) => a.status === 'ACTIVE' && currentVersion(a)?.accountSubtype === 'ACCOUNTS_RECEIVABLE',
  );
  const apAccount = (accounts.data ?? []).find(
    (a) => a.status === 'ACTIVE' && currentVersion(a)?.accountSubtype === 'ACCOUNTS_PAYABLE',
  );

  const reconcilableBanks = (bankAccounts.data ?? []).filter(
    (b) => b.isReconcilable && b.status === 'ACTIVE',
  );

  const bankGlCodes = reconcilableBanks
    .map((b) => (accounts.data ?? []).find((a) => a.id === b.glAccountId)?.code)
    .filter(Boolean) as string[];

  const canRun = Boolean(arAccount && apAccount);

  function handleRun() {
    if (!arAccount || !apAccount) return;
    reconcile.mutate({
      arAccountCode: arAccount.code,
      apAccountCode: apAccount.code,
      bankAccountCodes: bankGlCodes.length > 0 ? bankGlCodes : undefined,
      periodId: periodId || undefined,
    });
  }

  const isLoading = accounts.isPending || bankAccounts.isPending;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-40 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (accounts.isError || bankAccounts.isError) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  const report = reconcile.data;

  return (
    <div className="space-y-8">
      <p className="max-w-prose text-body-sm text-muted-foreground">{t('subtitle')}</p>

      {/* Detected control accounts */}
      <section aria-labelledby="rec-accounts-heading" className="space-y-4">
        <SectionHeader id="rec-accounts-heading" title={t('detectedHeading')} />

        {!arAccount && <Alert variant="error" messages={[t('noArAccount')]} />}
        {!apAccount && <Alert variant="error" messages={[t('noApAccount')]} />}

        {arAccount && apAccount && (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <DetectedField
              label={t('arAccount')}
              code={arAccount.code}
              name={currentVersion(arAccount)?.name ?? ''}
            />
            <DetectedField
              label={t('apAccount')}
              code={apAccount.code}
              name={currentVersion(apAccount)?.name ?? ''}
            />
            <div className="col-span-2 min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('bankAccountsLabel')}
              </dt>
              {reconcilableBanks.length === 0 ? (
                <dd className="mt-1 text-sm text-muted-foreground">{t('noBankAccounts')}</dd>
              ) : (
                <dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {reconcilableBanks.map((b) => (
                    <span key={b.id} className="text-sm text-foreground">
                      {b.accountName}
                    </span>
                  ))}
                </dd>
              )}
            </div>
          </dl>
        )}
      </section>

      {/* Period scope + run */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-64">
          <FormField htmlFor="rec-period" label={t('periodLabel')}>
            <Select id="rec-period" value={periodId} onChange={setPeriodId}>
              <option value="">{t('periodAll')}</option>
              {(fiscalYears.data ?? []).flatMap((fy) =>
                fy.periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {fy.name} – {p.name}
                  </option>
                )),
              )}
            </Select>
          </FormField>
        </div>
        <Button type="button" onClick={handleRun} disabled={!canRun || reconcile.isPending}>
          {reconcile.isPending ? t('running') : t('runButton')}
        </Button>
      </div>

      {reconcile.isError && <Alert variant="error" messages={[t('runFailed')]} />}

      {/* Results */}
      {report && (
        <section aria-labelledby="rec-result-heading" className="space-y-4">
          <SectionHeader id="rec-result-heading" title={t('resultHeading')} />

          {report.allReconciled ? (
            <Alert
              variant="success"
              title={t('allReconciled')}
              messages={[t('allReconciledBody')]}
            />
          ) : (
            <div className="space-y-2">
              <Alert
                variant="error"
                title={t('hasVariance')}
                messages={[t('hasVarianceBody')]}
              />
              {report.blocksClose && (
                <Alert variant="warning" messages={[t('blocksClose')]} />
              )}
            </div>
          )}

          <TableScroll aria-label={t('resultHeading')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colAccount')}</TableHead>
                  <TableHead>{t('colType')}</TableHead>
                  <TableHead className="text-end">{t('colGl')}</TableHead>
                  <TableHead className="text-end">{t('colSubledger')}</TableHead>
                  <TableHead className="text-end">{t('colVariance')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.checks.map((check) => (
                  <CheckRow key={`${check.accountCode}-${check.subledgerType}`} check={check} locale={locale} />
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        </section>
      )}
    </div>
  );
}

function DetectedField({ label, code, name }: { label: string; code: string; name: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm text-foreground">
        <span className="font-mono">{code}</span>
        {name ? <span className="text-muted-foreground"> · {name}</span> : null}
      </dd>
    </div>
  );
}

function CheckRow({ check, locale }: { check: ControlAccountCheck; locale: 'en' }) {
  const t = useTranslations('accounting.reconciliation');
  const variance = parseFloat(check.variance);

  return (
    <TableRow>
      <TableCell>
        <span className="font-mono text-xs">{check.accountCode}</span>
        <span className="ml-2 text-sm text-muted-foreground">{check.accountName}</span>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {check.subledgerType === 'AR'
          ? t('typeAr')
          : check.subledgerType === 'AP'
            ? t('typeAp')
            : t('typeBank')}
      </TableCell>
      <TableCell className="text-end tabular-nums text-sm">
        {formatMoney(check.glBalance, 'USD', locale)}
      </TableCell>
      <TableCell className="text-end tabular-nums text-sm">
        {formatMoney(check.subledgerBalance, 'USD', locale)}
      </TableCell>
      <TableCell
        className={`text-end tabular-nums text-sm ${variance !== 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
      >
        {formatMoney(check.variance, 'USD', locale)}
      </TableCell>
      <TableCell>
        <Badge tone={check.reconciled ? 'success' : 'danger'}>
          {check.reconciled ? t('statusOk') : t('statusVariance')}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
