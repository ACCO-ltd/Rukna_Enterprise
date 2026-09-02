'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Controller, useForm, useWatch, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Alert, Button, FormField, FormSection, Input, Select, Textarea, useToast } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { FormActions } from '@/components/form-actions';
import { FormErrorSummary, type FormFieldError } from '@/components/form-error-summary';
import { findClientDuplicateCandidates } from '../api/clients-api';
import { EMPTY_CLIENT_FORM, toClientFormValues, toCreateClientPayload, toUpdateClientPayload, type ClientFormValues } from '../client-form-payload';
import { useCreateClient, useUpdateClient } from '../hooks/use-client';
import type { Client } from '../types';

interface ClientFormProps { client?: Client }

/**
 * Create and edit a client.
 *
 * ─── Why this is one page and not a wizard ───────────────────────────────────────
 *
 * It used to be a two-step wizard: step one held two fields, step two held four. A wizard
 * earns its cost when a later step depends on an earlier answer, or when the flow is long
 * enough that one page would be daunting — neither is true of six fields, and the doctrine's
 * own blacklist (ux-doctrine §7) rejects "a wizard where a form works". Stepping it also meant
 * a step-one panel holding two inputs in a column sized for a whole document, which is what
 * made the screen read as empty.
 *
 * ─── The shape ───────────────────────────────────────────────────────────────────
 *
 * One panel, sections separated by hairlines (§2.1: structure by rules and background steps,
 * not by a box around every group), and one action bar joined to the panel's foot. The
 * identity of the record comes first, then who we talk to, then anything optional.
 */
export function ClientForm({ client }: ClientFormProps = {}) {
  const t = useTranslations('platform.clients.create');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();
  const isEdit = Boolean(client);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);

  const schema = z.object({
    name: z.string().trim().min(1, t('nameRequired')).max(255, t('nameTooLong')),
    type: z.enum(['COMPANY', 'GOVERNMENT', 'NGO', 'INDIVIDUAL', 'OTHER']).optional(),
    taxNumber: z.string(), defaultCurrency: z.string(), address: z.string().optional(), notes: z.string().optional(),
    contactName: z.string().trim().min(1, t('contactNameRequired')).max(255, t('nameTooLong')),
    contactRole: z.string().trim().max(100, t('contactRoleTooLong')),
    contactPhone: z.string().trim().max(50, t('contactPhoneTooLong')),
    contactEmail: z.string().trim().email(t('contactEmailInvalid')).or(z.literal('')),
  }).superRefine((values, ctx) => {
    if ((values.contactPhone || values.contactEmail || values.contactRole) && !values.contactName) {
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
  const candidates = allowDuplicate ? [] : (duplicateQuery.data ?? []);

  useEffect(() => {
    if (!isDirty || mutation.isSuccess) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, mutation.isSuccess]);

  const fieldErrors: FormFieldError[] = [
    errors.name ? { label: t('name'), fieldId: 'client-name', message: errors.name.message! } : null,
    errors.contactName ? { label: t('contactName'), fieldId: 'client-contact-name', message: errors.contactName.message! } : null,
    errors.contactRole ? { label: t('contactRole'), fieldId: 'client-contact-role', message: errors.contactRole.message! } : null,
    errors.contactPhone ? { label: t('contactPhone'), fieldId: 'client-contact-phone', message: errors.contactPhone.message! } : null,
    errors.contactEmail ? { label: t('contactEmail'), fieldId: 'client-contact-email', message: errors.contactEmail.message! } : null,
  ].filter(Boolean) as FormFieldError[];
  const apiErrors = mutation.error ? [mutation.error instanceof ApiError ? mutation.error.message : t('failed')] : [];
  const hasSummary = fieldErrors.length > 0 || apiErrors.length > 0;

  const submit = (values: ClientFormValues) => {
    if (isEdit && client) return update.mutate(toUpdateClientPayload(values));
    create.mutate(toCreateClientPayload(values), {
      onSuccess: (created) => {
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
        <FormPanel>
          {hasSummary ? <FormErrorSummary errors={fieldErrors} formErrors={apiErrors} /> : null}

          <FormSection title={t('identityStep')} description={t('identityDescription')} variant="plain">
            {/* Full width, alone on its row: the name is what the record *is*, and pairing it with
                a dropdown would give a secondary attribute equal weight. */}
            <FormField htmlFor="client-name" label={t('name')} hint={t('nameHint')} error={errors.name?.message} required>
              <Input id="client-name" placeholder={t('namePlaceholder')} autoFocus={!isEdit} {...register('name', { onChange: () => setAllowDuplicate(false) })} />
            </FormField>

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField htmlFor="client-type" label={t('clientType')} required>
                <ClientTypeSelect control={control} t={t} />
              </FormField>

              {/* The code is a read-only field rather than a notice above the form: a value the
                  system assigns still has a place in the record, and giving it one shows the user
                  where it will appear instead of only telling them that it exists. */}
              <FormField htmlFor="client-code" label={t('code')} hint={isEdit ? undefined : t('codeAutoHint')}>
                <Input id="client-code" readOnly value={client?.code ?? t('codeAuto')} />
              </FormField>
            </div>

            {candidates.length > 0 ? <DuplicateWarning candidates={candidates} onContinue={() => setAllowDuplicate(true)} t={t} /> : null}
          </FormSection>

          {/* Contact capture belongs to creation only. On an existing client the contact list is
              its own aggregate with its own add/remove affordances (ClientContacts), and offering
              a second, single-contact editor here would be two ways to change one thing. */}
          {isEdit ? null : (
            <FormSection title={t('contactStep')} description={t('contactDescription')} variant="plain">
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField htmlFor="client-contact-name" label={t('contactName')} error={errors.contactName?.message} required><Input id="client-contact-name" placeholder={t('contactNamePlaceholder')} {...register('contactName')} /></FormField>
                <FormField htmlFor="client-contact-role" label={t('contactRole')} error={errors.contactRole?.message}><Input id="client-contact-role" placeholder={t('contactRolePlaceholder')} {...register('contactRole')} /></FormField>
                <FormField htmlFor="client-contact-phone" label={t('contactPhone')} error={errors.contactPhone?.message}><Input id="client-contact-phone" type="tel" placeholder={t('contactPhonePlaceholder')} {...register('contactPhone')} /></FormField>
                <FormField htmlFor="client-contact-email" label={t('contactEmail')} error={errors.contactEmail?.message}><Input id="client-contact-email" type="email" placeholder={t('contactEmailPlaceholder')} {...register('contactEmail')} /></FormField>
              </div>
            </FormSection>
          )}

          <FormSection title={t('notesSection')} description={t('notesDescription')} variant="plain">
            <FormField htmlFor="client-notes" label={t('notes')} hint={t('notesHint')}>
              <Textarea id="client-notes" placeholder={t('notesPlaceholder')} {...register('notes')} />
            </FormField>
          </FormSection>
        </FormPanel>

        <FormActionBar
          submitLabel={isEdit ? t('saveChanges') : t('submit')}
          pendingLabel={isEdit ? undefined : t('creating')}
          isPending={mutation.isPending}
          cancelHref={isEdit ? `/clients/${client!.id}` : undefined}
          onCancel={isEdit ? undefined : () => (isDirty ? setShowLeaveConfirm(true) : router.push('/clients'))}
          cancelLabel={t('cancel')}
        />
      </form>

      {showLeaveConfirm ? <ConfirmActionDialog title={tCommon('unsavedChanges.title')} description={tCommon('unsavedChanges.body')} confirmLabel={tCommon('unsavedChanges.leave')} isPending={false} onConfirm={() => router.push('/clients')} onDismiss={() => setShowLeaveConfirm(false)} /> : null}
    </>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────
// One surface for the whole document, with the action bar joined to its foot. The panel drops
// its bottom border and the bar carries the matching bottom rounding, so the two read as a
// single object rather than as a card with something parked underneath it.

function FormPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-t-panel border border-b-0 border-border bg-surface px-5 py-6 shadow-e1 sm:px-8">
      <div className="space-y-8">{children}</div>
    </div>
  );
}

function FormActionBar(props: React.ComponentProps<typeof FormActions>) {
  return <FormActions {...props} className="rounded-b-panel border border-border shadow-e1 sm:px-8" />;
}

// ─── Fields ───────────────────────────────────────────────────────────────────

function ClientTypeSelect({ control, t }: { control: Control<ClientFormValues>; t: ReturnType<typeof useTranslations<'platform.clients.create'>> }) {
  return <Controller
           control={control}
           name="type"
           render={({ field }) => (
             <Select id="client-type" value={field.value} onChange={field.onChange}><option value="COMPANY">{t('clientTypes.COMPANY')}</option><option value="GOVERNMENT">{t('clientTypes.GOVERNMENT')}</option><option value="NGO">{t('clientTypes.NGO')}</option><option value="INDIVIDUAL">{t('clientTypes.INDIVIDUAL')}</option><option value="OTHER">{t('clientTypes.OTHER')}</option></Select>
           )}
         />;
}

function DuplicateWarning({ candidates, onContinue, t }: { candidates: Awaited<ReturnType<typeof findClientDuplicateCandidates>>; onContinue: () => void; t: ReturnType<typeof useTranslations<'platform.clients.create'>> }) {
  return <Alert variant="warning" messages={[t('possibleDuplicate')]}><div className="mt-3 space-y-2">{candidates.map((candidate) => <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2"><span className="text-sm font-medium text-foreground">{candidate.name}</span><Button asChild size="sm" variant="outline"><Link href={`/clients/${candidate.id}`} target="_blank">{t('openClient')}</Link></Button></div>)}<Button type="button" size="sm" variant="ghost" onClick={onContinue}>{t('continueAnyway')}</Button></div></Alert>;
}
