'use client';

/**
 * The supplier master (Tier A).
 *
 * Not one of §12.4's four setup screens — suppliers had no endpoint when that section was
 * written — but the same shape, so it reuses `SetupScreen` and `CreateForm` rather than
 * inventing a fifth layout.
 *
 * Two things make it different from its four neighbours, and both come from the API:
 *
 *  - **Correction, not deactivation** (A15 / D8, merged in PR 152). `PATCH /suppliers/:id` edits
 *    the master fields — name, tax number, currency, terms, address — so the actions column
 *    carries an Edit control. It carries no deactivate: `status` is owned by a separate flow
 *    and this endpoint cannot move it. The supplier `code` is the stable identity and is not
 *    editable, so it is shown read-only in the form.
 *  - **The list is not filtered to ACTIVE.** `status` is a real query parameter here rather
 *    than a hard-coded `'ACTIVE'` (P2), so an inactive supplier would be visible if one
 *    could exist. None can, which is why the column is rendered but no filter is offered.
 */

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  FormField,
  Input,
  Sheet,
  SheetContent,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import {
  ACCOUNTING_PERMISSIONS,
  PROCUREMENT_PERMISSIONS,
  usePermissions,
} from '@/features/auth/permissions/can';

import { useCreateSupplier, useSuppliers, useUpdateSupplier } from '../hooks/use-procurement';
import type { Supplier, UpdateSupplierPayload } from '../types';
import { ProcurementStatusBadge } from './procurement-badges';
import { CreateForm, SetupScreen } from './setup-shell';

/** Case-insensitive match across the three fields a user would search by. */
export function filterSuppliers(suppliers: Supplier[], query: string): Supplier[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return suppliers;
  return suppliers.filter((s) =>
    [s.code, s.name]
      .some((field) => field.toLocaleLowerCase().includes(q)),
  );
}

export function SupplierList() {
  const t = useTranslations('procurement.supplier');
  const tc = useTranslations('procurement.common');
  const { can } = usePermissions();

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Supplier | null>(null);
  const suppliers = useSuppliers();
  const searchId = useId();

  const canManage = can(PROCUREMENT_PERMISSIONS.manageSuppliers);
  // The edit affordance is gated on the permission the API enforces on `PATCH /suppliers/:id`
  // (`manage:payable`), not on `manage:supplier` — matching the endpoint's own guard means a
  // viewer never sees an Edit button the server would reject.
  const canEdit = can(ACCOUNTING_PERMISSIONS.managePayables);

  // Filtered in the browser: `GET /suppliers` takes no `search` parameter, the same gap
  // materials have (P1). A supplier master is small and bounded, so one fetch beats one
  // request per keystroke.
  const rows = useMemo(
    () => filterSuppliers(suppliers.data ?? [], query),
    [suppliers.data, query],
  );

  return (
    <SetupScreen
      title={t('title')}
      subtitle={t('subtitle')}
      notice={t('writeOnceNotice')}
      createLabel={t('new')}
      createTitle={t('createTitle')}
      canCreate={canManage}
      createForm={(close) => <SupplierCreateForm onDone={close} />}
      isPending={suppliers.isPending}
      isError={suppliers.isError}
    >
      <div className="max-w-sm">
        <label
          htmlFor={searchId}
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          {tc('search')}
        </label>
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          autoComplete="off"
        />
      </div>

      <TableScroll aria-label={t('title')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc('code')}</TableHead>
              <TableHead>{tc('name')}</TableHead>
              <TableHead>{t('taxNumber')}</TableHead>
              <TableHead>{t('paymentTerms')}</TableHead>
              <TableHead>{tc('status')}</TableHead>
              <TableHead>
                <span className="sr-only">{tc('actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={6}>
                {query ? tc('noResults') : t('empty')}
              </TableEmpty>
            ) : (
              rows.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell className="font-mono text-xs">{supplier.code}</TableCell>
                  <TableCell>
                    <span className="text-sm text-foreground">{supplier.name}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {supplier.taxNumber ?? tc('notAvailable')}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {supplier.paymentTermsDays === null
                      ? tc('notAvailable')
                      : t('paymentTermsDays', { days: supplier.paymentTermsDays })}
                  </TableCell>
                  <TableCell>
                    <ProcurementStatusBadge status={supplier.status} />
                  </TableCell>
                  <TableCell className="text-end">
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => setEditing(supplier)}
                        aria-label={t('editAction', { code: supplier.code })}
                        className="min-h-11 text-sm font-medium text-brand-primary underline-offset-2 hover:underline"
                      >
                        {t('edit')}
                      </button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableScroll>

      <Sheet open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
        <SheetContent className="p-6">
          <SheetTitle className="text-lg font-semibold text-foreground">
            {t('editTitle')}
          </SheetTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('editSubtitle')}</p>
          {editing ? (
            <div className="mt-5">
              <SupplierEditForm supplier={editing} onDone={() => setEditing(null)} />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </SetupScreen>
  );
}

// ─── Create ──────────────────────────────────────────────────────────────────────

function SupplierCreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('procurement.supplier');
  const tc = useTranslations('procurement.common');

  const ids = {
    code: useId(),
    name: useId(),
    taxNumber: useId(),
    currency: useId(),
    terms: useId(),
  };

  const create = useCreateSupplier();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const code = String(form.get('code') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();
    const taxNumber = String(form.get('taxNumber') ?? '').trim();
    const terms = String(form.get('paymentTermsDays') ?? '').trim();

    if (!code || !name) return;

    // `paymentTermsDays` is @IsInt() @Min(0). An empty field must be omitted rather than
    // sent as 0 — "pay immediately" and "not recorded" are different facts about a supplier.
    const paymentTermsDays = terms === '' ? undefined : Number(terms);
    if (paymentTermsDays !== undefined && !Number.isInteger(paymentTermsDays)) return;

    create.mutate(
      {
        code,
        name,
        ...(taxNumber ? { taxNumber } : {}),
        // Single-currency platform (ADR-024): suppliers default to USD implicitly.
        defaultCurrency: 'USD',
        ...(paymentTermsDays !== undefined ? { paymentTermsDays } : {}),
      },
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
      {/* The code is permanent — the other fields can be corrected later from Edit (A15 /
          D8). Said before the fields rather than after, where it would be an epitaph. */}
      <Alert variant="warning" messages={[t('noEditWarning')]} />

      <FormField htmlFor={ids.code} label={tc('code')}>
        <Input id={ids.code} name="code" required maxLength={50} autoComplete="off" />
        <p className="text-xs text-muted-foreground">{t('codeHint')}</p>
      </FormField>

      <FormField htmlFor={ids.name} label={tc('name')}>
        <Input id={ids.name} name="name" required maxLength={255} autoComplete="off" />
      </FormField>

      <FormField htmlFor={ids.taxNumber} label={`${t('taxNumber')} (${tc('optional')})`}>
        <Input id={ids.taxNumber} name="taxNumber" maxLength={50} autoComplete="off" />
        <p className="text-xs text-muted-foreground">{t('taxNumberHint')}</p>
      </FormField>

      <FormField htmlFor={ids.terms} label={`${t('paymentTerms')} (${tc('optional')})`}>
        <Input
          id={ids.terms}
          name="paymentTermsDays"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t('paymentTermsHint')}</p>
      </FormField>
    </CreateForm>
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
function SupplierEditForm({
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
