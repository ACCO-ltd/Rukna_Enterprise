'use client';

import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { GuaranteeStatus } from '@erp/types';
import {
  Alert,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
  MoneyInput,
  Select,
} from '@erp/ui';

import { toDecimalString } from '../contract-form-payload';
import { useAddGuarantee, useUpdateGuarantee } from '../hooks/use-contract-terms';

const GUARANTEE_STATUSES: GuaranteeStatus[] = [
  GuaranteeStatus.ACTIVE,
  GuaranteeStatus.DISCHARGED,
  GuaranteeStatus.EXPIRED,
  GuaranteeStatus.CALLED,
];

/**
 * The commercial facts a guarantee is created with. `PATCH /contracts/:id/guarantees/:gid`
 * accepts only `status` and `notes` — the type, amount, issuer, beneficiary and dates are fixed
 * once the instrument is recorded (see `updateGuarantee` in `contracts-api.ts`). So the edit
 * dialog shows those facts read-only and edits only the two mutable fields.
 */
export interface EditableGuarantee {
  id: string;
  guaranteeType: string;
  amount: string;
  currency: string;
  issuer: string;
  beneficiary: string;
  issueDate: string;
  expiryDate: string;
  status: `${GuaranteeStatus}`;
  /**
   * The commercial summary row does not carry notes, only the contract-detail shape does. When it
   * is `undefined` the dialog starts the notes field blank and omits `notes` from the PATCH unless
   * the user types something, so an existing note is never silently cleared.
   */
  notes?: string | null;
}

interface AddFormValues {
  guaranteeType: string;
  amount: string;
  issuer: string;
  beneficiary: string;
  issueDate: string;
  expiryDate: string;
  notes: string;
}

interface EditFormValues {
  status: GuaranteeStatus;
  notes: string;
}

/**
 * Add/edit a contract guarantee in a dialog, wired to the existing
 * `POST/PATCH /contracts/:id/guarantees` endpoints.
 *
 * Extracted from `guarantees-panel.tsx` so both the dead `ContractDetail` view and the Commercial
 * workspace mount the same form. Two shapes, one instrument:
 *  - **add** — the full form; every commercial fact is captured (POST).
 *  - **edit** — only `status` and `notes` are mutable (PATCH); the rest is shown for context.
 *
 * `onSuccess` lets the caller invalidate its own read model — the mutations already refresh the
 * contract detail; the workspace additionally passes an invalidation of the commercial summary.
 */
export function GuaranteeFormDialog(props: {
  contractId: string;
  /** Present for edit, absent for add. */
  guarantee?: EditableGuarantee;
  onClose: () => void;
  /** Runs after a successful mutation, before the dialog closes. */
  onSuccess?: () => void | Promise<void>;
}) {
  return props.guarantee ? (
    <EditGuaranteeDialog
      contractId={props.contractId}
      guarantee={props.guarantee}
      onClose={props.onClose}
      onSuccess={props.onSuccess}
    />
  ) : (
    <AddGuaranteeDialog
      contractId={props.contractId}
      onClose={props.onClose}
      onSuccess={props.onSuccess}
    />
  );
}

function AddGuaranteeDialog({
  contractId,
  onClose,
  onSuccess,
}: {
  contractId: string;
  onClose: () => void;
  onSuccess?: () => void | Promise<void>;
}) {
  const t = useTranslations('platform.contracts.terms.guarantees');
  const tCommon = useTranslations('common');
  const add = useAddGuarantee(contractId);

  const {
    control,
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<AddFormValues>({
    defaultValues: {
      guaranteeType: 'PERFORMANCE',
      amount: '',
      issuer: '',
      beneficiary: '',
      issueDate: '',
      expiryDate: '',
      notes: '',
    },
  });

  const onSubmit = (values: AddFormValues) => {
    add.mutate(
      {
        guaranteeType: values.guaranteeType.trim(),
        amount: toDecimalString(values.amount),
        // Single-currency platform (ADR-024): USD is implicit, never entered.
        currency: 'USD',
        issuer: values.issuer.trim(),
        beneficiary: values.beneficiary.trim(),
        issueDate: values.issueDate,
        expiryDate: values.expiryDate,
        ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
      },
      {
        onSuccess: async () => {
          await onSuccess?.();
          onClose();
        },
      },
    );
  };

  const required = { validate: (v: string) => v.trim() !== '' || t('required') };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !add.isPending) onClose();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (add.isPending) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (add.isPending) e.preventDefault();
        }}
      >
        <DialogTitle>{t('add')}</DialogTitle>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 space-y-4"
          noValidate
        >
          {add.isError ? <Alert variant="error" messages={[t('failed')]} /> : null}

          <FormField
            htmlFor="guarantee-type"
            label={t('type')}
            error={errors.guaranteeType?.message}
          >
            <Input
              id="guarantee-type"
              aria-describedby="guarantee-type-hint"
              aria-invalid={Boolean(errors.guaranteeType)}
              {...register('guaranteeType', required)}
            />
            <p id="guarantee-type-hint" className="text-xs text-muted-foreground">
              {t('typeHint')}
            </p>
          </FormField>

          <div className="grid gap-4">
            <FormField htmlFor="guarantee-amount" label={t('amount')} error={errors.amount?.message}>
              <Controller
                name="amount"
                control={control}
                rules={{
                  validate: (v) =>
                    (v.trim() !== '' && Number.isFinite(Number(v))) || t('required'),
                }}
                render={({ field }) => (
                  <MoneyInput
                    id="guarantee-amount"
                    dir="ltr"
                    aria-invalid={Boolean(errors.amount)}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    name={field.name}
                  />
                )}
              />
            </FormField>
          </div>

          <FormField htmlFor="guarantee-issuer" label={t('issuer')} error={errors.issuer?.message}>
            <Input
              id="guarantee-issuer"
              aria-invalid={Boolean(errors.issuer)}
              {...register('issuer', required)}
            />
          </FormField>

          <FormField
            htmlFor="guarantee-beneficiary"
            label={t('beneficiary')}
            error={errors.beneficiary?.message}
          >
            <Input
              id="guarantee-beneficiary"
              aria-invalid={Boolean(errors.beneficiary)}
              {...register('beneficiary', required)}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              htmlFor="guarantee-issue"
              label={t('issueDate')}
              error={errors.issueDate?.message}
            >
              <Controller
                control={control}
                name="issueDate"
                rules={required}
                render={({ field }) => (
                  <DatePicker id="guarantee-issue" value={field.value} onChange={field.onChange} />
                )}
              />
            </FormField>

            <FormField
              htmlFor="guarantee-expiry"
              label={t('expiryDate')}
              error={errors.expiryDate?.message}
            >
              <Controller
                control={control}
                name="expiryDate"
                rules={{
                  validate: (v) => {
                    if (v.trim() === '') return t('required');
                    const issue = getValues('issueDate');
                    // A guarantee that expires before it was issued is a data-entry error
                    // the API does not catch — both dates are only @IsDateString().
                    return !issue || v >= issue || t('expiryBeforeIssue');
                  },
                }}
                render={({ field }) => (
                  <DatePicker
                    id="guarantee-expiry"
                    value={field.value}
                    onChange={field.onChange}
                    min={getValues('issueDate') || undefined}
                  />
                )}
              />
            </FormField>
          </div>

          <FormField htmlFor="guarantee-notes" label={t('notes')}>
            <Input id="guarantee-notes" {...register('notes')} />
          </FormField>

          <DialogFooter>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? tCommon('loading') : t('save')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={add.isPending}>
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditGuaranteeDialog({
  contractId,
  guarantee,
  onClose,
  onSuccess,
}: {
  contractId: string;
  guarantee: EditableGuarantee;
  onClose: () => void;
  onSuccess?: () => void | Promise<void>;
}) {
  const t = useTranslations('platform.contracts.terms.guarantees');
  const tCommon = useTranslations('common');
  const update = useUpdateGuarantee(contractId);

  // Notes may be unknown to the caller (the summary row omits them). Start blank in that case and
  // only send `notes` on submit when the user has typed — never blank out an existing, unseen note.
  const notesKnown = guarantee.notes !== undefined;
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<EditFormValues>({
    defaultValues: {
      status: guarantee.status as GuaranteeStatus,
      notes: guarantee.notes ?? '',
    },
  });

  const onSubmit = (values: EditFormValues) => {
    const trimmed = values.notes.trim();
    update.mutate(
      {
        guaranteeId: guarantee.id,
        status: values.status,
        // Only include notes when we can safely represent the field: either we knew the prior
        // value (edit from contract detail) or the user typed one (edit from the workspace row).
        ...(notesKnown || trimmed ? { notes: trimmed } : {}),
      },
      {
        onSuccess: async () => {
          await onSuccess?.();
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !update.isPending) onClose();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (update.isPending) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (update.isPending) e.preventDefault();
        }}
      >
        <DialogTitle>{t('editTitle')}</DialogTitle>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 space-y-4"
          noValidate
        >
          {update.isError ? <Alert variant="error" messages={[t('updateFailed')]} /> : null}

          {/* The commercial facts are fixed after creation — shown for context, not editable. */}
          <dl className="grid gap-3 rounded-panel border border-border bg-surface p-3 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('type')}</dt>
              <dd className="text-foreground">{guarantee.guaranteeType}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('issuer')}</dt>
              <dd className="text-foreground">{guarantee.issuer}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('beneficiary')}</dt>
              <dd className="text-foreground">{guarantee.beneficiary}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('expiryDate')}</dt>
              <dd className="text-foreground">{guarantee.expiryDate}</dd>
            </div>
          </dl>

          <FormField htmlFor="guarantee-status" label={t('status')} error={errors.status?.message}>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select
                  id="guarantee-status"
                  name={field.name}
                  value={field.value}
                  onChange={(value) => {
                    field.onChange(value as GuaranteeStatus);
                  }}
                >
                  {GUARANTEE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`statuses.${status}`)}
                    </option>
                  ))}
                </Select>
              )}
            />
          </FormField>

          <FormField htmlFor="guarantee-notes" label={t('notes')}>
            <Input id="guarantee-notes" {...register('notes')} />
          </FormField>

          <DialogFooter>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? tCommon('loading') : tCommon('save')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
