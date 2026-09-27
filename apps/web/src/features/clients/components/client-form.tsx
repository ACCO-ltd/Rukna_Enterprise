'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Controller, useForm, useWatch, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Users } from 'lucide-react';
import {
  Button,
  FormActionBar,
  FormField,
  FormGroup,
  Input,
  RECORD_NAME_INPUT,
  RecordCreateHeader,
  Select,
  Textarea,
  useToast,
  type FormSaveState,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { FormErrorSummary, type FormFieldError } from '@/components/form-error-summary';
import { findClientDuplicateCandidates } from '../api/clients-api';
import { EMPTY_CLIENT_FORM, toClientFormValues, toCreateClientPayload, toUpdateClientPayload, type ClientFormValues } from '../client-form-payload';
import { useCreateClient, useUpdateClient } from '../hooks/use-client';
import type { Client } from '../types';

interface ClientFormProps { client?: Client; onCreated?: (client: Client) => void; onCancel?: () => void }

type ClientCreateT = ReturnType<typeof useTranslations<'platform.clients.create'>>;

/**
 * Create and edit a client — the ADR-037 create page.
 *
 * ─── The shape ───────────────────────────────────────────────────────────────────
 *
 * Sticky action bar (back, one Save, Discard, save state) → the error summary when a save
 * failed → the record header (icon tile + the name, set large, because the name is what the
 * record will be known by) → "* Required" → two hairline groups: Details (how the client
 * appears on invoices and in search) and Contact (who ACCO calls). Notes stay behind a
 * disclosure: they are optional and internal.
 *
 * It is one page and not a wizard: six-odd fields with no dependency between them is a form,
 * and ux-doctrine §7 rejects "a wizard where a form works".
 *
 * ─── Three hosts ─────────────────────────────────────────────────────────────────
 *
 * The /clients/new page, the edit page (`ClientEdit`), and inline inside the project create
 * form (`onCreated` / `onCancel`), where saving hands the new client back to the project
 * instead of navigating, and there is no back link because the project form is the context.
 *
 * ─── Contacts on edit ────────────────────────────────────────────────────────────
 *
 * Contact capture belongs to creation only. On an existing client the contact list is its own
 * aggregate with its own add/remove affordances (ClientContacts); a second single-contact
 * editor here would be two ways to change one thing. The address is a client column, so it
 * stays editable.
 *
 * Not here, by decision (ADR-037): a hand-typed short code (the server assigns CLI-000001),
 * district (ADR-025: it belongs to the project), payment terms, receivable account, an
 * "email invoices" toggle and a registration number — none exist in the API.
 */
export function ClientForm({ client, onCreated, onCancel }: ClientFormProps = {}) {
  const t = useTranslations('platform.clients.create');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();
  const isEdit = Boolean(client);
  const isInline = Boolean(onCreated || onCancel);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const schema = z.object({
    name: z.string().trim().min(1, t('nameRequired')).max(255, t('nameTooLong')),
    type: z.enum(['COMPANY', 'GOVERNMENT', 'NGO', 'INDIVIDUAL', 'OTHER']).optional(),
    taxNumber: z.string().trim().max(50, t('taxNumberTooLong')),
    defaultCurrency: z.string(),
    address: z.string().optional(),
    contactName: z.string().trim().max(255, t('nameTooLong')),
    contactRole: z.string().trim().max(100, t('contactRoleTooLong')),
    contactPhone: z.string().trim().max(50, t('contactPhoneTooLong')).refine(
      (value) => value === '' || /^[+]?[-\s().\d]{7,50}$/.test(value),
      t('contactPhoneInvalid'),
    ),
    contactEmail: z.string().trim().email(t('contactEmailInvalid')).or(z.literal('')),
    notes: z.string().trim().max(2000, t('notesTooLong')),
  }).superRefine((values, ctx) => {
    if (!isEdit && !values.contactName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contactName'], message: t('contactNameRequired') });
    }
  });

  const create = useCreateClient();
  const update = useUpdateClient(client?.id ?? '');
  const mutation = isEdit ? update : create;
  const form = useForm<ClientFormValues>({ resolver: zodResolver(schema), defaultValues: client ? toClientFormValues(client) : EMPTY_CLIENT_FORM });
  const { register, handleSubmit, control, formState: { errors, isDirty } } = form;
  const name = useWatch({ control, name: 'name' });
  const duplicateQuery = useQuery({
    queryKey: ['clients', 'duplicate-candidates', name.trim()],
    queryFn: () => findClientDuplicateCandidates(name.trim()),
    enabled: !isEdit && name.trim().length >= 3,
    staleTime: 30_000,
  });
  // A warning, not an error (ADR-037): two clients can legitimately share a name, so this
  // never blocks the save. It names what to check and links to it.
  const candidates = duplicateQuery.data ?? [];

  useEffect(() => {
    if (!isDirty || mutation.isSuccess) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, mutation.isSuccess]);

  const fieldErrors: FormFieldError[] = [
    errors.name ? { label: t('clientName'), fieldId: 'client-name', message: errors.name.message! } : null,
    errors.taxNumber ? { label: t('taxId'), fieldId: 'client-tax-number', message: errors.taxNumber.message! } : null,
    errors.contactName ? { label: t('contactName'), fieldId: 'client-contact-name', message: errors.contactName.message! } : null,
    errors.contactRole ? { label: t('contactRole'), fieldId: 'client-contact-role', message: errors.contactRole.message! } : null,
    errors.contactPhone ? { label: t('contactPhone'), fieldId: 'client-contact-phone', message: errors.contactPhone.message! } : null,
    errors.contactEmail ? { label: t('contactEmail'), fieldId: 'client-contact-email', message: errors.contactEmail.message! } : null,
    errors.notes ? { label: t('notes'), fieldId: 'client-notes', message: errors.notes.message! } : null,
  ].filter(Boolean) as FormFieldError[];
  const apiErrors = mutation.error ? [mutation.error instanceof ApiError ? mutation.error.message : t('failed')] : [];
  const hasSummary = fieldErrors.length > 0 || apiErrors.length > 0;

  const discardHref = isEdit ? `/clients/${client!.id}` : '/clients';
  const leave = () => (onCancel ? onCancel() : router.push(discardHref));
  const discard = () => (isDirty ? setShowLeaveConfirm(true) : leave());

  const saveState: FormSaveState = isDirty ? 'dirty' : isEdit ? 'clean' : 'new';

  const submit = (values: ClientFormValues) => {
    if (mutation.isPending) return;
    if (isEdit && client) return update.mutate(toUpdateClientPayload(values));
    create.mutate(toCreateClientPayload(values), {
      onSuccess: (created) => {
        if (onCreated) { onCreated(created); return; }
        toast({
          tone: 'success', title: t('createdToast'), description: `${created.name} · ${created.code}`, duration: 9000,
          action: { label: t('createProject'), onClick: () => router.push(`/projects/new?clientId=${created.id}`) },
        });
        router.push(`/clients/${created.id}`);
      },
    });
  };

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(submit)(event)} noValidate>
        <FormActionBar
          back={isInline ? undefined : (
            <Button asChild variant="ghost" className="gap-1.5 px-2">
              <Link href="/clients"><ArrowLeft size={16} aria-hidden="true" />{t('backToList')}</Link>
            </Button>
          )}
          save={<Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? t('saving') : t('save')}</Button>}
          discard={<Button type="button" variant="ghost" onClick={discard} disabled={mutation.isPending}>{t('discard')}</Button>}
          saveState={saveState}
          saveStateLabels={{ new: tCommon('formState.new'), dirty: tCommon('formState.dirty'), clean: tCommon('formState.clean') }}
        />

        <div className="space-y-8">
          {hasSummary ? <FormErrorSummary errors={fieldErrors} formErrors={apiErrors} /> : null}

          <div className="space-y-3">
            <RecordCreateHeader icon={<Users size={20} />}>
              <FormField
                htmlFor="client-name"
                label={t('clientName')}
                hint={t('clientNameHint')}
                error={errors.name?.message}
                warning={candidates.length > 0 ? t('possibleDuplicate') : undefined}
                required
              >
                <Input id="client-name" className={RECORD_NAME_INPUT} placeholder={t('namePlaceholder')} autoFocus={!isEdit} {...register('name')} />
              </FormField>
              {candidates.length > 0 ? <DuplicateLinks candidates={candidates} t={t} /> : null}
            </RecordCreateHeader>
            <RequiredNote label={tCommon('required')} />
          </div>

          <FormGroup title={t('detailsGroup')} description={t('detailsGroupHint')}>
            <FormField htmlFor="client-type" label={t('clientType')} required>
              <ClientTypeSelect control={control} t={t} />
            </FormField>
            <FormField htmlFor="client-tax-number" label={t('taxId')} error={errors.taxNumber?.message}>
              <Input id="client-tax-number" placeholder={t('taxIdPlaceholder')} {...register('taxNumber')} />
            </FormField>
            {isEdit ? (
              <FormField htmlFor="client-code" label={t('code')}>
                <Input id="client-code" readOnly value={client?.code ?? ''} className="bg-muted text-muted-foreground" />
              </FormField>
            ) : null}
          </FormGroup>

          <FormGroup title={t('contactGroup')} description={isEdit ? t('contactGroupEditHint') : t('contactGroupHint')}>
            {isEdit ? null : (
              <>
                <FormField htmlFor="client-contact-name" label={t('contactName')} error={errors.contactName?.message} required>
                  <Input id="client-contact-name" placeholder={t('contactNamePlaceholder')} {...register('contactName')} />
                </FormField>
                <FormField htmlFor="client-contact-role" label={t('contactRole')} error={errors.contactRole?.message}>
                  <Input id="client-contact-role" placeholder={t('contactRolePlaceholder')} {...register('contactRole')} />
                </FormField>
                <FormField htmlFor="client-contact-phone" label={t('contactPhone')} hint={t('contactPhoneHint')} error={errors.contactPhone?.message}>
                  <Input id="client-contact-phone" type="tel" placeholder={t('contactPhonePlaceholder')} {...register('contactPhone')} />
                </FormField>
                <FormField htmlFor="client-contact-email" label={t('contactEmail')} error={errors.contactEmail?.message}>
                  <Input id="client-contact-email" type="email" placeholder={t('contactEmailPlaceholder')} {...register('contactEmail')} />
                </FormField>
              </>
            )}
            <FormField htmlFor="client-address" label={t('address')} className="sm:col-span-2">
              <Textarea id="client-address" rows={2} placeholder={t('addressPlaceholder')} {...register('address')} />
            </FormField>
          </FormGroup>

          <details open={isEdit || Boolean(errors.notes) || undefined}>
            <summary className="cursor-pointer text-body-sm font-medium text-foreground">{t('notesSection')}</summary>
            <div className="pt-4">
              <FormField htmlFor="client-notes" label={t('notes')} hint={t('notesHint')} error={errors.notes?.message}>
                <Textarea id="client-notes" placeholder={t('notesPlaceholder')} {...register('notes')} />
              </FormField>
            </div>
          </details>
        </div>
      </form>

      {showLeaveConfirm ? <ConfirmActionDialog title={tCommon('unsavedChanges.title')} description={tCommon('unsavedChanges.body')} confirmLabel={tCommon('unsavedChanges.leave')} isPending={false} onConfirm={leave} onDismiss={() => setShowLeaveConfirm(false)} /> : null}
    </>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

/** "* Required" — the one line that says what the asterisks mean. */
export function RequiredNote({ label }: { label: string }) {
  return (
    <p className="text-caption text-muted-foreground">
      <span className="me-0.5 text-danger" aria-hidden="true">*</span>
      {label}
    </p>
  );
}

function ClientTypeSelect({ control, t }: { control: Control<ClientFormValues>; t: ClientCreateT }) {
  return <Controller
           control={control}
           name="type"
           render={({ field }) => (
             <Select id="client-type" value={field.value} onChange={field.onChange}><option value="COMPANY">{t('clientTypes.COMPANY')}</option><option value="GOVERNMENT">{t('clientTypes.GOVERNMENT')}</option><option value="NGO">{t('clientTypes.NGO')}</option><option value="INDIVIDUAL">{t('clientTypes.INDIVIDUAL')}</option><option value="OTHER">{t('clientTypes.OTHER')}</option></Select>
           )}
         />;
}

/** The possible duplicates behind the name field's warning, each opening in a new tab. */
function DuplicateLinks({ candidates, t }: { candidates: Awaited<ReturnType<typeof findClientDuplicateCandidates>>; t: ClientCreateT }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-caption" aria-label={t('possibleDuplicate')}>
      {candidates.map((candidate) => (
        <li key={candidate.id}>
          <Link href={`/clients/${candidate.id}`} target="_blank" className="font-medium text-brand-primary underline-offset-2 hover:underline">
            {t('openClient')}: {candidate.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
