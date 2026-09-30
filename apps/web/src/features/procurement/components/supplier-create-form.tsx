'use client';

/**
 * New supplier — a full page (ADR-037: master-data creation is a page, not a dialog).
 *
 * Only what `POST /suppliers` accepts: name and short code (both required by the DTO), tax ID,
 * and payment terms. Currency is not asked: the platform is USD-only (ADR-024), so it is sent
 * as USD. Supplier type, spend category, contacts, district, payable account and address are
 * deliberately absent — none is in the create API (ADR-037, "Design conflicts resolved"); the
 * address can be added afterwards from Edit.
 *
 * Payment terms are a closed set of the terms ACCO actually agrees — Due on receipt and Net
 * 7/14/30/45/60/90 — because they now drive something: a new bill's due date is set from them.
 */

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormActionBar,
  FormField,
  FormGroup,
  Input,
  RECORD_NAME_INPUT,
  RecordCreateHeader,
  Select,
} from '@erp/ui';
import { ArrowLeft, Truck } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { FormErrorSummary, type FormFieldError } from '@/components/form-error-summary';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';

import { useCreateSupplier } from '../hooks/use-procurement';

const SUPPLIERS_HREF = '/procurement/suppliers';

/** The terms offered, in days. 0 reads as "Due on receipt". */
export const PAYMENT_TERMS_DAYS = [0, 7, 14, 30, 45, 60, 90] as const;

const IDS = {
  name: 'supplier-name',
  code: 'supplier-code',
  taxNumber: 'supplier-tax-id',
  terms: 'supplier-terms',
} as const;

type Field = 'name' | 'code' | 'terms';

export function SupplierCreateForm() {
  const t = useTranslations('procurement.supplier.create');
  const tSupplier = useTranslations('procurement.supplier');
  const tc = useTranslations('procurement.common');
  const tCommon = useTranslations('common');
  const tForm = useTranslations('common.formState');
  const router = useRouter();
  const { can } = usePermissions();

  useModuleTrail(t('trail'));

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [terms, setTerms] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const create = useCreateSupplier();
  const dirty = Boolean(name || code || taxNumber || terms);

  useEffect(() => {
    if (!dirty || create.isSuccess) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, create.isSuccess]);

  if (!can(PROCUREMENT_PERMISSIONS.manageSuppliers)) {
    return <Alert variant="error" messages={[tc('permissionDenied')]} />;
  }

  const errors: Partial<Record<Field, string>> = {};
  if (!name.trim()) errors.name = t('errors.name');
  if (!code.trim()) errors.code = t('errors.code');
  if (terms === '') errors.terms = t('errors.terms');

  // A duplicate code is the one conflict this endpoint returns; its message names the code.
  const conflict = create.error instanceof ApiError && create.error.status === 409 ? create.error.message : null;
  const shown = (field: Field): string | undefined =>
    field === 'code' && conflict ? conflict : submitted ? errors[field] : undefined;

  const labels: Record<Field, string> = { name: t('name'), code: t('code'), terms: t('terms') };
  const summary: FormFieldError[] = (['name', 'code', 'terms'] as const).flatMap((field) => {
    const message = shown(field);
    return message ? [{ label: labels[field], fieldId: IDS[field], message }] : [];
  });
  const formErrors =
    create.error && !conflict
      ? [create.error instanceof ApiError ? create.error.message : t('failed')]
      : [];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (create.isPending || Object.keys(errors).length > 0) return;

    create.mutate(
      {
        code: code.trim(),
        name: name.trim(),
        ...(taxNumber.trim() ? { taxNumber: taxNumber.trim() } : {}),
        // Single-currency platform (ADR-024): suppliers default to USD implicitly.
        defaultCurrency: 'USD',
        paymentTermsDays: Number(terms),
      },
      { onSuccess: () => router.push(SUPPLIERS_HREF) },
    );
  }

  const leave = () => router.push(SUPPLIERS_HREF);
  const clearServerError = () => {
    if (create.error) create.reset();
  };

  return (
    <>
      <form onSubmit={handleSubmit} noValidate>
        <FormActionBar
          back={
            <Button asChild variant="ghost" className="gap-1.5 px-2">
              <Link href={SUPPLIERS_HREF}>
                <ArrowLeft size={16} aria-hidden="true" />
                {tSupplier('title')}
              </Link>
            </Button>
          }
          save={
            <Button type="submit" loading={create.isPending} loadingText={t('saving')}>
              {t('save')}
            </Button>
          }
          discard={
            <Button type="button" variant="ghost" onClick={() => (dirty ? setConfirmLeave(true) : leave())}>
              {t('discard')}
            </Button>
          }
          saveState={dirty ? 'dirty' : 'new'}
          saveStateLabels={{ new: tForm('new'), dirty: tForm('dirty'), clean: tForm('clean') }}
        />

        <div className="space-y-8">
          {summary.length > 0 || formErrors.length > 0 ? (
            <FormErrorSummary errors={summary} formErrors={formErrors} />
          ) : null}

          <RecordCreateHeader icon={<Truck size={20} />}>
            <FormField htmlFor={IDS.name} label={t('name')} required hint={t('nameHint')} error={shown('name')}>
              <Input
                id={IDS.name}
                className={RECORD_NAME_INPUT}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={255}
                autoComplete="off"
                autoFocus
              />
            </FormField>
          </RecordCreateHeader>

          <FormGroup title={t('detailsTitle')} description={t('detailsDescription')}>
            <FormField htmlFor={IDS.code} label={t('code')} required hint={t('codeHint')} error={shown('code')}>
              <Input
                id={IDS.code}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  clearServerError();
                }}
                maxLength={50}
                autoComplete="off"
                className="font-mono"
              />
            </FormField>
            <FormField htmlFor={IDS.taxNumber} label={t('taxId')} hint={tSupplier('taxNumberHint')}>
              <Input
                id={IDS.taxNumber}
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.target.value)}
                maxLength={50}
                autoComplete="off"
              />
            </FormField>
          </FormGroup>

          <FormGroup title={t('payablesTitle')} description={t('payablesDescription')}>
            <FormField htmlFor={IDS.terms} label={t('terms')} required hint={t('termsHint')} error={shown('terms')}>
              <Select id={IDS.terms} value={terms} onChange={setTerms}>
                <option value="" disabled>
                  {t('termsPlaceholder')}
                </option>
                {PAYMENT_TERMS_DAYS.map((days) => (
                  <option key={days} value={String(days)}>
                    {days === 0 ? t('termsDueOnReceipt') : t('termsNet', { days })}
                  </option>
                ))}
              </Select>
            </FormField>
          </FormGroup>
        </div>
      </form>

      {confirmLeave ? (
        <ConfirmActionDialog
          title={tCommon('unsavedChanges.title')}
          description={tCommon('unsavedChanges.body')}
          confirmLabel={tCommon('unsavedChanges.leave')}
          isPending={false}
          onConfirm={leave}
          onDismiss={() => setConfirmLeave(false)}
        />
      ) : null}
    </>
  );
}
