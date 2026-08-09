'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { usePermissions } from '@/features/auth/permissions/can';
import { PROCUREMENT_PERMISSIONS } from '@/features/auth/permissions/can';

import { useCreateUom, useDeactivateUom, useUoms } from '../hooks/use-procurement';
import type { UnitOfMeasure } from '../types';
import { ProcurementStatusBadge } from './procurement-badges';
import { CreateForm, SetupScreen } from './setup-shell';

/**
 * Units of measure (§12.4).
 *
 * §12.4 asks for a status filter. There is none, and cannot be: `uom.service.ts` passes a
 * hard-coded `'ACTIVE'` and the controller takes no `status` parameter (P2). So the list
 * is active-only and says so, and the deactivate dialog warns that the row will vanish
 * rather than change state in front of the user — which is what actually happens.
 */
export function UomList() {
  const t = useTranslations('procurement.uom');
  const tc = useTranslations('procurement.common');
  const { can } = usePermissions();

  const uoms = useUoms();
  const [pendingDeactivate, setPendingDeactivate] = useState<UnitOfMeasure | null>(null);
  const deactivate = useDeactivateUom();

  const canManage = can(PROCUREMENT_PERMISSIONS.manageConfig);

  return (
    <>
      <SetupScreen
        title={t('title')}
        subtitle={t('subtitle')}
        notice={t('activeOnlyNotice')}
        createLabel={t('new')}
        createTitle={t('createTitle')}
        canCreate={canManage}
        createForm={(close) => <UomCreateForm onDone={close} />}
        isPending={uoms.isPending}
        isError={uoms.isError}
      >
        <TableScroll aria-label={t('title')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc('code')}</TableHead>
                <TableHead>{tc('name')}</TableHead>
                <TableHead>{t('symbol')}</TableHead>
                <TableHead>{tc('status')}</TableHead>
                <TableHead>
                  <span className="sr-only">{tc('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(uoms.data ?? []).length === 0 ? (
                <TableEmpty colSpan={5}>{t('empty')}</TableEmpty>
              ) : (
                (uoms.data ?? []).map((uom) => (
                  <TableRow key={uom.id}>
                    <TableCell className="font-mono text-xs">{uom.code}</TableCell>
                    <TableCell>
                      <span className="text-sm text-foreground">{uom.name}</span>
                      {uom.nameAr ? (
                        <span className="ms-2 text-xs text-muted-foreground">
                          <bdi>{uom.nameAr}</bdi>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <bdi className="text-sm">{uom.symbol}</bdi>
                    </TableCell>
                    <TableCell>
                      <ProcurementStatusBadge status={uom.status} />
                    </TableCell>
                    <TableCell>
                      {canManage && uom.status === 'ACTIVE' ? (
                        <button
                          type="button"
                          onClick={() => setPendingDeactivate(uom)}
                          className="min-h-11 text-sm font-medium text-danger underline-offset-2 hover:underline"
                        >
                          {t('deactivate')}
                        </button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableScroll>
      </SetupScreen>

      {pendingDeactivate ? (
        <ConfirmActionDialog
          title={t('deactivateTitle', { code: pendingDeactivate.code })}
          description={`${t('deactivateBody')} ${t('deactivateWarning', {
            code: pendingDeactivate.code,
          })}`}
          confirmLabel={t('deactivate')}
          isPending={deactivate.isPending}
          errorMessage={deactivate.isError ? tc('loadFailed') : undefined}
          onConfirm={() =>
            deactivate.mutate(pendingDeactivate.id, {
              onSuccess: () => setPendingDeactivate(null),
            })
          }
          onDismiss={() => setPendingDeactivate(null)}
        />
      ) : null}
    </>
  );
}

function UomCreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('procurement.uom');
  const tc = useTranslations('procurement.common');
  const ids = { code: useId(), name: useId(), nameAr: useId(), symbol: useId() };

  const create = useCreateUom();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const code = String(form.get('code') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();
    const symbol = String(form.get('symbol') ?? '').trim();
    const nameAr = String(form.get('nameAr') ?? '').trim();

    if (!code || !name || !symbol) return;

    create.mutate(
      { code, name, symbol, ...(nameAr ? { nameAr } : {}) },
      { onSuccess: onDone },
    );
  }

  return (
    <CreateForm
      onSubmit={handleSubmit}
      isPending={create.isPending}
      error={create.error}
      onCancel={onDone}
    >
      <FormField htmlFor={ids.code} label={tc('code')}>
        <Input id={ids.code} name="code" required maxLength={20} autoComplete="off" />
        <p className="text-xs text-muted-foreground">{t('codeHint')}</p>
      </FormField>

      <FormField htmlFor={ids.name} label={tc('name')}>
        <Input id={ids.name} name="name" required autoComplete="off" />
      </FormField>

      <FormField htmlFor={ids.nameAr} label={`${tc('nameAr')} (${tc('optional')})`}>
        <Input id={ids.nameAr} name="nameAr" dir="rtl" lang="ar" autoComplete="off" />
      </FormField>

      <FormField htmlFor={ids.symbol} label={t('symbol')}>
        <Input id={ids.symbol} name="symbol" required maxLength={10} autoComplete="off" />
        <p className="text-xs text-muted-foreground">{t('symbolHint')}</p>
      </FormField>
    </CreateForm>
  );
}
