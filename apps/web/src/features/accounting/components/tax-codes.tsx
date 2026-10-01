'use client';

/**
 * Accounting → Tax (ADR-041).
 *
 * The tax codes a client invoice can be raised at, and which sales code is the organisation's
 * default. A code's rate never changes once created — a new rate is a new code made the default —
 * and "no tax" is an OUTPUT code at 0%.
 *
 * `view:accounting` (and invoice preparers, `manage:receivable`) read the list;
 * `manage:accounting` creates codes, (de)activates them and picks the default sales code.
 */

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  ChoiceCards,
  ConfirmDialog,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormDialogSection,
  FormField,
  Input,
  Notice,
  OverflowGlyph,
  RowActions,
  StatusPill,
} from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { statusTone } from '@/lib/status-registry';

import {
  useCreateTaxCode,
  useSetDefaultTaxCode,
  useSetTaxCodeActive,
  useTaxCodes,
} from '../hooks/use-accounting';
import {
  canMakeDefault,
  formatRatePercent,
  taxCodeProblems,
  toCreateTaxCodeBody,
  type TaxCode,
  type TaxCodeDraft,
  type TaxDirection,
} from '../tax-codes';

export function TaxCodes() {
  const t = useTranslations('accounting.taxCodes');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const mayManage = can(ACCOUNTING_PERMISSIONS.manageChart);

  const taxCodes = useTaxCodes();
  const makeDefault = useSetDefaultTaxCode();
  const status = useSetTaxCodeActive();

  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<TaxCode | null>(null);

  const codes = taxCodes.data?.codes ?? [];
  const hasDefault = Boolean(taxCodes.data?.defaultOutputTaxCodeId);

  const columns: GridColumn<TaxCode>[] = [
    {
      key: 'code',
      header: t('colCode'),
      sticky: true,
      sortable: true,
      plainValue: (code) => code.code,
      render: (code) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption tabular-nums">{code.code}</span>
          {code.isDefault ? <Badge tone="progress">{t('defaultBadge')}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'name',
      header: t('colName'),
      sortable: true,
      plainValue: (code) => code.name,
      render: (code) => <span className="text-sm text-foreground">{code.name}</span>,
    },
    {
      key: 'rate',
      header: t('colRate'),
      numeric: true,
      sortable: true,
      plainValue: (code) => Number(code.ratePercent),
      render: (code) => (
        <span className="text-sm tabular-nums text-foreground">
          {t('rate', { rate: formatRatePercent(code.ratePercent) })}
        </span>
      ),
    },
    {
      key: 'direction',
      header: t('colDirection'),
      sortable: true,
      plainValue: (code) => code.direction,
      render: (code) => (
        <span className="text-sm text-foreground">{t(`direction.${code.direction}`)}</span>
      ),
    },
    {
      key: 'effectiveFrom',
      header: t('colEffectiveFrom'),
      sortable: true,
      plainValue: (code) => code.effectiveFrom,
      render: (code) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatDate(code.effectiveFrom) ?? code.effectiveFrom}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('colStatus'),
      render: (code) => (
        <StatusPill tone={statusTone(code.status, 'masterData')}>
          {t(`status.${code.status}`)}
        </StatusPill>
      ),
    },
  ];

  const createAction = mayManage ? (
    <Button type="button" onClick={() => setCreating(true)}>
      {t('create.new')}
    </Button>
  ) : null;

  const apiMessage = (error: unknown): string | null =>
    error instanceof ApiError && error.message ? error.message : null;

  // A refused (de)activation stays inside the confirmation, which stays open.
  const statusError = !status.isError
    ? null
    : status.error instanceof ApiError && status.error.code === 'TAX_CODE_IS_DEFAULT'
      ? t('deactivate.isDefault')
      : (apiMessage(status.error) ?? t('actionFailed', { code: status.variables?.code ?? '' }));

  const makeDefaultError = makeDefault.isError
    ? (apiMessage(makeDefault.error) ??
      t('actionFailed', { code: makeDefault.variables?.code ?? '' }))
    : null;

  const deactivating = toggling?.status === 'ACTIVE';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-h2 font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{t('description')}</p>
      </div>

      {taxCodes.isSuccess && codes.length > 0 && !hasDefault ? (
        <Notice tone="attention">{t('noDefault')}</Notice>
      ) : null}

      {makeDefaultError ? <Alert variant="error" messages={[makeDefaultError]} /> : null}

      <PlatformDataGrid
        columns={columns}
        data={codes}
        rowKey={(code) => code.id}
        label={t('title')}
        isLoading={taxCodes.isPending}
        isError={taxCodes.isError}
        onRetry={() => void taxCodes.refetch()}
        errorMessage={t('loadFailed')}
        emptyState={
          codes.length === 0 ? (
            <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                {t('emptyHint')}
              </p>
              {createAction ? <div className="mt-4 flex justify-center">{createAction}</div> : null}
            </div>
          ) : undefined
        }
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 50 }}
        toolbarActions={createAction}
        rowActions={
          mayManage
            ? (code) => {
                const active = code.status === 'ACTIVE';
                return (
                  <RowActions
                    overflow={
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('rowMenu', { code: code.code })}
                          >
                            <OverflowGlyph />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {code.isDefault ? (
                            // Not offered: say why rather than hide it silently.
                            <DropdownMenuItem disabled>
                              <span className="flex flex-col">
                                <span>{t('deactivate.action')}</span>
                                <span className="text-caption text-muted-foreground">
                                  {t('deactivate.defaultHint')}
                                </span>
                              </span>
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => {
                                status.reset();
                                setToggling(code);
                              }}
                            >
                              {active ? t('deactivate.action') : t('reactivate.action')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    }
                  >
                    {canMakeDefault(code) ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        loading={makeDefault.isPending && makeDefault.variables?.id === code.id}
                        disabled={makeDefault.isPending}
                        onClick={() => makeDefault.mutate({ id: code.id, code: code.code })}
                        aria-label={`${t('makeDefault.action')} ${code.code}`}
                      >
                        {t('makeDefault.action')}
                      </Button>
                    ) : null}
                  </RowActions>
                );
              }
            : undefined
        }
      />

      {!mayManage ? (
        <p className="max-w-prose text-xs text-muted-foreground">{t('readOnlyNote')}</p>
      ) : null}

      {creating ? (
        <CreateTaxCodeForm
          takenCodes={new Set(codes.map((code) => code.code))}
          onDone={() => setCreating(false)}
        />
      ) : null}

      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(open) => {
          if (!open) setToggling(null);
        }}
        variant={deactivating ? 'destructive' : 'default'}
        title={
          toggling
            ? deactivating
              ? t('deactivate.title', { code: toggling.code })
              : t('reactivate.title', { code: toggling.code })
            : ''
        }
        description={
          <>
            <span className="block">
              {deactivating ? t('deactivate.body') : t('reactivate.body')}
            </span>
            {statusError ? (
              <span role="alert" className="mt-3 block font-medium text-danger">
                {statusError}
              </span>
            ) : null}
          </>
        }
        confirmLabel={deactivating ? t('deactivate.confirm') : t('reactivate.confirm')}
        cancelLabel={tCommon('cancel')}
        isPending={status.isPending}
        onConfirm={() => {
          if (!toggling) return;
          const target = toggling;
          status.mutate(
            { id: target.id, code: target.code, active: target.status !== 'ACTIVE' },
            { onSuccess: () => setToggling(null) },
          );
        }}
      />
    </div>
  );
}

// ─── New tax code ────────────────────────────────────────────────────────────────

const EMPTY_DRAFT: TaxCodeDraft = {
  code: '',
  name: '',
  ratePercent: '',
  direction: 'OUTPUT',
  effectiveFrom: '',
};

/** A `FormDialog` (ADR-039), size `md`. The caller mounts it to open it. */
export function CreateTaxCodeForm({
  takenCodes,
  onDone,
}: {
  takenCodes: ReadonlySet<string>;
  onDone: () => void;
}) {
  const t = useTranslations('accounting.taxCodes.create');
  const tCommon = useTranslations('common');
  const ids = { name: useId(), code: useId(), rate: useId(), from: useId() };

  const [draft, setDraft] = useState<TaxCodeDraft>(EMPTY_DRAFT);
  const [showErrors, setShowErrors] = useState(false);
  const create = useCreateTaxCode();

  const problems = taxCodeProblems(draft, takenCodes);
  const shown = showErrors ? problems : [];
  const patch = (next: Partial<TaxCodeDraft>) => setDraft((d) => ({ ...d, ...next }));

  const serverError = !create.isError
    ? null
    : create.error instanceof ApiError && create.error.code === 'TAX_CODE_TAKEN'
      ? t('problem.code-taken')
      : create.error instanceof ApiError && create.error.code === 'TAX_CODE_INVALID'
        ? t('problem.code')
        : create.error instanceof ApiError && create.error.code === 'TAX_RATE_INVALID'
          ? t('problem.rate')
          : create.error instanceof ApiError && create.error.message
            ? create.error.message
            : t('failed');

  function handleSubmit() {
    setShowErrors(true);
    if (problems.length > 0) return;
    create.mutate(toCreateTaxCodeBody(draft), { onSuccess: onDone });
  }

  const dirty =
    draft.code !== '' ||
    draft.name !== '' ||
    draft.ratePercent !== '' ||
    draft.direction !== EMPTY_DRAFT.direction ||
    draft.effectiveFrom !== '';

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onDone();
      }}
      title={t('title')}
      size="md"
      dirty={dirty}
      busy={create.isPending}
      closeLabel={tCommon('close')}
      onSubmit={() => handleSubmit()}
    >
      <FormDialogBody className="space-y-6">
        <FormDialogSection>
          <FormField
            htmlFor={ids.name}
            label={t('name')}
            error={shown.includes('name') ? t('problem.name') : undefined}
          >
            <Input
              id={ids.name}
              value={draft.name}
              placeholder={t('namePlaceholder')}
              onChange={(e) => patch({ name: e.target.value })}
              maxLength={100}
              autoComplete="off"
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              htmlFor={ids.code}
              label={t('code')}
              hint={t('codeHint')}
              error={
                shown.includes('code')
                  ? t('problem.code')
                  : shown.includes('code-taken')
                    ? t('problem.code-taken')
                    : undefined
              }
            >
              <Input
                id={ids.code}
                value={draft.code}
                onChange={(e) => patch({ code: e.target.value.toUpperCase() })}
                maxLength={10}
                autoComplete="off"
                className="font-mono"
              />
            </FormField>

            <FormField
              htmlFor={ids.rate}
              label={t('rate')}
              hint={t('rateHint')}
              error={shown.includes('rate') ? t('problem.rate') : undefined}
            >
              <Input
                id={ids.rate}
                value={draft.ratePercent}
                onChange={(e) => patch({ ratePercent: e.target.value })}
                inputMode="decimal"
                maxLength={8}
                autoComplete="off"
              />
            </FormField>
          </div>

          <ChoiceCards<TaxDirection>
            label={t('direction')}
            value={draft.direction}
            onChange={(direction) => patch({ direction })}
            columns={2}
            options={[
              { value: 'OUTPUT', label: t('OUTPUT'), hint: t('OUTPUTHint') },
              { value: 'INPUT', label: t('INPUT'), hint: t('INPUTHint') },
            ]}
          />
          {shown.includes('direction') ? (
            <p role="alert" className="text-caption text-danger">
              {t('problem.direction')}
            </p>
          ) : null}

          <FormField
            htmlFor={ids.from}
            label={`${t('effectiveFrom')} (${tCommon('optional')})`}
            hint={t('effectiveFromHint')}
            className="max-w-xs"
          >
            <DatePicker
              id={ids.from}
              value={draft.effectiveFrom}
              onChange={(effectiveFrom) => patch({ effectiveFrom })}
            />
          </FormField>
        </FormDialogSection>

        {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={create.isPending}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" loading={create.isPending} loadingText={tCommon('saving')}>
          {t('submit')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
