'use client';

/**
 * The supplier directory (GET /procurement/suppliers) on the shared list pattern.
 *
 * Search and Status run on the server (status default All). Columns: supplier (name + code),
 * contact, terms, open orders, what we owe, status. "We owe" follows the server's
 * `moneyVisible` (view:commitment-ledger) — hidden money is an absent column, never $0.
 *
 * Row commands are the permissions the endpoints enforce: Edit (PATCH /suppliers/:id) and
 * Deactivate… / Reactivate (POST /suppliers/:id/deactivate|reactivate) all need manage:payable.
 * The supplier code is the permanent identity; that is said once, as the Code field's hint on
 * the create and edit forms, not as a banner here.
 */

import { useId, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, EmptyState, FormField, Input, type FilterValues, type ListFilterField } from '@erp/ui';
import { Plus } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import {
  ACCOUNTING_PERMISSIONS,
  PROCUREMENT_PERMISSIONS,
  usePermissions,
} from '@/features/auth/permissions/can';
import { formatMoney } from '@/lib/format';
import { formatPhone } from '@/lib/phone';

import {
  useDeactivateSupplier,
  useReactivateSupplier,
  useSupplier,
  useSupplierDirectory,
  useUpdateSupplier,
} from '../hooks/use-procurement';
import type { CatalogueStatusFilter, Supplier, SupplierDirectoryRow, UpdateSupplierPayload } from '../types';
import { ListRowMenu, errorText } from './list-row-menu';
import { ProcurementStatusBadge } from './procurement-badges';
import { CreateForm } from './setup-shell';
import { useListControls } from './use-list-controls';

export function SupplierList() {
  const t = useTranslations('procurement.supplier');
  const tList = useTranslations('procurement.supplier.list');
  const tSetup = useTranslations('procurement.setup');
  const tc = useTranslations('procurement.common');
  const { can } = usePermissions();

  const canCreate = can(PROCUREMENT_PERMISSIONS.manageSuppliers);
  // Edit and the status commands gate on the permission their endpoints enforce.
  const canManage = can(ACCOUNTING_PERMISSIONS.managePayables);

  const [filters, setFilters] = useState<FilterValues>({});
  const controls = useListControls();
  const directory = useSupplierDirectory({
    ...(filters.status ? { status: filters.status as CatalogueStatusFilter } : {}),
    ...(controls.debouncedSearch ? { search: controls.debouncedSearch } : {}),
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = useSupplier(editingId ?? '');
  const [pending, setPending] = useState<{ row: SupplierDirectoryRow; action: 'deactivate' | 'reactivate' } | null>(null);
  const deactivate = useDeactivateSupplier();
  const reactivate = useReactivateSupplier();
  const command = pending?.action === 'reactivate' ? reactivate : deactivate;

  const rows = useMemo(() => directory.data ?? [], [directory.data]);
  const moneyVisible =
    rows.find((row) => row.moneyVisible !== undefined)?.moneyVisible ?? can(PROCUREMENT_PERMISSIONS.viewCommitments);

  const dash = <span className="text-muted-foreground">{tc('notAvailable')}</span>;

  const columns: GridColumn<SupplierDirectoryRow>[] = [
    {
      key: 'supplier',
      header: tList('columns.supplier'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (row) => row.name,
      render: (row) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-foreground">{row.name}</span>
          <span className="block font-mono text-caption text-muted-foreground">{row.code}</span>
        </span>
      ),
    },
    {
      key: 'contact',
      header: tList('columns.contact'),
      card: 'subtitle',
      render: (row) =>
        row.primaryContact ? (
          <span className="block min-w-0">
            <span className="block truncate">{row.primaryContact.name}</span>
            {row.primaryContact.phone ? (
              <span className="block text-caption tabular-nums text-muted-foreground" dir="ltr">
                {formatPhone(row.primaryContact.phone)}
              </span>
            ) : null}
          </span>
        ) : (
          dash
        ),
    },
    {
      key: 'terms',
      header: tList('columns.terms'),
      sortable: true,
      plainValue: (row) => row.paymentTermsDays,
      render: (row) =>
        row.paymentTermsDays === null ? dash : tList('netDays', { days: row.paymentTermsDays }),
    },
    {
      key: 'openOrders',
      header: tList('columns.openOrders'),
      sortable: true,
      card: 'meta',
      plainValue: (row) => row.openOrderCount,
      render: (row) =>
        row.openOrderCount === 0 ? (
          <span className="text-muted-foreground">{tList('noOpenOrders')}</span>
        ) : (
          tList('openOrders', { count: row.openOrderCount })
        ),
    },
  ];
  if (moneyVisible) {
    columns.push({
      key: 'owe',
      header: tList('columns.owe'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (row) => (row.payableBalance === null ? null : Number(row.payableBalance)),
      render: (row) => {
        // Several currencies are listed one per line; a single balance reads as one figure.
        const balances = row.payableBalances ?? [];
        if (balances.length > 1) {
          return (
            <span className="block tabular-nums">
              {balances.map((b) => (
                <span key={b.currencyCode} className="block">
                  {formatMoney(b.amount, b.currencyCode)}
                </span>
              ))}
            </span>
          );
        }
        if (row.payableBalance === null) return dash;
        return (
          <span className="tabular-nums">
            {formatMoney(row.payableBalance, balances[0]?.currencyCode ?? row.defaultCurrency ?? 'USD')}
          </span>
        );
      },
    });
  }
  columns.push({
    key: 'status',
    header: tList('columns.status'),
    card: 'status',
    render: (row) => <ProcurementStatusBadge vocabulary="masterData" status={row.status} />,
  });

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: tSetup('status'),
      options: (['ACTIVE', 'INACTIVE'] as const).map((value) => ({ value, label: tSetup(`statusOption.${value}`) })),
    },
  ];

  const isNarrowed = Boolean(controls.search) || Object.values(filters).some(Boolean);
  const isFirstUse = !isNarrowed && directory.data !== undefined && rows.length === 0;
  const view = controls.view(rows, columns);

  const createAction = canCreate ? (
    <Button asChild>
      <Link href="/procurement/suppliers/new">
        <Plus className="size-4" aria-hidden="true" />
        {tList('new')}
      </Link>
    </Button>
  ) : undefined;

  return (
    <div className="space-y-3">
      <PlatformDataGrid
        columns={columns}
        data={view.data}
        rowKey={(row) => row.id}
        label={t('title')}
        isLoading={directory.isPending}
        isError={directory.isError}
        errorMessage={tc('loadFailed')}
        onRetry={() => void directory.refetch()}
        searchPlaceholder={tList('searchPlaceholder')}
        resultLabel={(count) => tList('countLabel', { count })}
        noMatchMessage={tList('noMatches')}
        server={view.server}
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={(next) => {
          setFilters(next);
          controls.resetPage();
        }}
        rowActions={
          canManage
            ? (row) => (
                <ListRowMenu
                  label={tc('rowMenu', { number: row.name })}
                  commands={[
                    { key: 'edit', label: t('edit'), onSelect: () => setEditingId(row.id) },
                    row.status === 'ACTIVE'
                      ? {
                          key: 'deactivate',
                          label: tSetup('deactivateMenu'),
                          onSelect: () => setPending({ row, action: 'deactivate' }),
                        }
                      : {
                          key: 'reactivate',
                          label: tSetup('reactivate'),
                          onSelect: () => setPending({ row, action: 'reactivate' }),
                        },
                  ]}
                />
              )
            : undefined
        }
        emptyState={
          isFirstUse ? <EmptyState title={tList('empty')} description={tList('emptyHint')} action={createAction} /> : undefined
        }
        toolbarActions={createAction}
      />
      {!moneyVisible && !directory.isPending && !directory.isError && !isFirstUse ? (
        <p className="text-caption text-muted-foreground">{tList('moneyHidden')}</p>
      ) : null}

      {editingId && editing.data ? (
        <SupplierEditForm supplier={editing.data} onDone={() => setEditingId(null)} />
      ) : null}

      {pending ? (
        <ConfirmActionDialog
          title={tList(pending.action === 'deactivate' ? 'deactivateTitle' : 'reactivateTitle', { name: pending.row.name })}
          description={tList(pending.action === 'deactivate' ? 'deactivateBody' : 'reactivateBody')}
          confirmLabel={pending.action === 'deactivate' ? tSetup('deactivate') : tSetup('reactivate')}
          destructive={pending.action === 'deactivate'}
          isPending={command.isPending}
          errorMessage={command.error ? errorText(command.error, tc('loadFailed')) : undefined}
          onConfirm={() => command.mutate(pending.row.id, { onSuccess: () => setPending(null) })}
          onDismiss={() => {
            command.reset();
            setPending(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Edit (A15 / D8) ───────────────────────────────────────────────────────────────

/**
 * Corrects supplier master data via `PATCH /suppliers/:id`.
 *
 * Sends only the fields that changed — a PATCH, not a replace — and refuses to submit an
 * unchanged form so the server's "at least one field" `400` is never provoked from the UI.
 * The `code` is shown read-only because it is the supplier's identity and the endpoint drops
 * it; `status` is absent entirely, owned by a separate flow the endpoint cannot reach.
 */
export function SupplierEditForm({
  supplier,
  onDone,
}: {
  supplier: Supplier;
  onDone: () => void;
}) {
  const t = useTranslations('procurement.supplier');
  const tc = useTranslations('procurement.common');

  const ids = {
    code: useId(),
    name: useId(),
    taxNumber: useId(),
    currency: useId(),
    terms: useId(),
    address: useId(),
  };

  const update = useUpdateSupplier();
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    currency?: string;
    terms?: string;
    form?: string;
  }>({});

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const name = String(form.get('name') ?? '').trim();
    const taxNumber = String(form.get('taxNumber') ?? '').trim();
    const currency = String(form.get('defaultCurrency') ?? '').trim().toUpperCase();
    const termsRaw = String(form.get('paymentTermsDays') ?? '').trim();
    const address = String(form.get('address') ?? '').trim();

    // Client validation, mirroring the DTO: name non-empty, currency exactly 3 chars if
    // present, terms a whole number ≥ 0 if present.
    const errors: typeof fieldErrors = {};
    if (!name) errors.name = t('nameRequired');
    if (currency && currency.length !== 3) errors.currency = t('currencyLength');

    const termsProvided = termsRaw !== '';
    const termsNum = termsProvided ? Number(termsRaw) : undefined;
    if (
      termsProvided &&
      (termsNum === undefined || !Number.isInteger(termsNum) || termsNum < 0)
    ) {
      errors.terms = t('termsInvalid');
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    // Build the patch from what actually changed. Empty string clears an optional text field;
    // the current value of each field is normalised the same way before comparison so that
    // re-saving an unchanged form sends nothing.
    const patch: UpdateSupplierPayload = {};
    if (name !== supplier.name) patch.name = name;
    if (taxNumber !== (supplier.taxNumber ?? '')) patch.taxNumber = taxNumber;
    if (currency !== (supplier.defaultCurrency ?? '')) patch.defaultCurrency = currency;
    if (address !== (supplier.address ?? '')) patch.address = address;

    const currentTerms =
      supplier.paymentTermsDays === null ? '' : String(supplier.paymentTermsDays);
    if (termsRaw !== currentTerms && termsProvided) patch.paymentTermsDays = termsNum;

    if (Object.keys(patch).length === 0) {
      setFieldErrors({ form: t('noChanges') });
      return;
    }

    setFieldErrors({});
    update.mutate({ id: supplier.id, payload: patch }, { onSuccess: onDone });
  }

  return (
    <CreateForm
      onSubmit={handleSubmit}
      isPending={update.isPending}
      error={update.error}
      onCancel={onDone}
      submitLabel={t('saveChanges')}
      title={t('editTitle')}
      subtitle={t('editSubtitle')}
    >
      {fieldErrors.form ? (
        <Alert variant="error" messages={[fieldErrors.form]} />
      ) : null}

      {/* The identity of the supplier — read-only, because the endpoint drops it. */}
      <FormField htmlFor={ids.code} label={t('codeReadOnly')}>
        <Input id={ids.code} value={supplier.code} readOnly className="font-mono" />
        <p className="text-xs text-muted-foreground">{t('codeReadOnlyHint')}</p>
      </FormField>

      <FormField htmlFor={ids.name} label={tc('name')} error={fieldErrors.name}>
        <Input
          id={ids.name}
          name="name"
          defaultValue={supplier.name}
          required
          maxLength={255}
          autoComplete="off"
        />
      </FormField>

      <FormField htmlFor={ids.taxNumber} label={`${t('taxNumber')} (${tc('optional')})`}>
        <Input
          id={ids.taxNumber}
          name="taxNumber"
          defaultValue={supplier.taxNumber ?? ''}
          maxLength={50}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t('taxNumberHint')}</p>
      </FormField>

      <FormField
        htmlFor={ids.currency}
        label={`${t('defaultCurrency')} (${tc('optional')})`}
        error={fieldErrors.currency}
      >
        <Input
          id={ids.currency}
          name="defaultCurrency"
          defaultValue={supplier.defaultCurrency ?? ''}
          maxLength={3}
          autoComplete="off"
          className="uppercase"
        />
        <p className="text-xs text-muted-foreground">{t('currencyHint')}</p>
      </FormField>

      <FormField
        htmlFor={ids.terms}
        label={`${t('paymentTerms')} (${tc('optional')})`}
        error={fieldErrors.terms}
      >
        <Input
          id={ids.terms}
          name="paymentTermsDays"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          defaultValue={supplier.paymentTermsDays ?? ''}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t('paymentTermsHint')}</p>
      </FormField>

      <FormField htmlFor={ids.address} label={`${t('address')} (${tc('optional')})`}>
        <Input
          id={ids.address}
          name="address"
          defaultValue={supplier.address ?? ''}
          maxLength={255}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t('addressHint')}</p>
      </FormField>
    </CreateForm>
  );
}
