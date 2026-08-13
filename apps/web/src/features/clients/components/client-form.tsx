'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Alert, Button, FormField, FormSection, Input, Select, Textarea, useToast } from '@erp/ui';
import { ArrowLeft, ArrowRight, Check, Info, CaretDown } from '@phosphor-icons/react';

import { ApiError } from '@/lib/api-client';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { FormActions } from '@/components/form-actions';
import { FormErrorSummary, type FormFieldError } from '@/components/form-error-summary';
import { findClientDuplicateCandidates } from '../api/clients-api';
import { EMPTY_CLIENT_FORM, toClientFormValues, toCreateClientPayload, toUpdateClientPayload, type ClientFormValues } from '../client-form-payload';
import { useCreateClient, useUpdateClient } from '../hooks/use-client';
import type { Client } from '../types';

interface ClientFormProps { client?: Client }

export function ClientForm({ client }: ClientFormProps = {}) {
  const t = useTranslations('platform.clients.create');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();
  const isEdit = Boolean(client);
  const [step, setStep] = useState<1 | 2>(1);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showNotes, setShowNotes] = useState(Boolean(client?.notes));
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
  const { register, handleSubmit, trigger, control, formState: { errors, isDirty } } = form;
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

  const submit = (values: ClientFormValues) => {
    if (isEdit && client) return update.mutate(toUpdateClientPayload(values));
    create.mutate(toCreateClientPayload(values), {
      onSuccess: (created) => {
        toast({
          tone: 'success', title: t('createdToast'), description: `${created.name} \u00b7 ${created.code}`, duration: 9000,
          action: { label: t('createProject'), onClick: () => router.push(`/projects/new?clientId=${created.id}`) },
        });
        router.push(`/clients/${created.id}`);
      },
    });
  };

  if (isEdit) {
    return (
      <form className="space-y-6 pb-24" onSubmit={(event) => void handleSubmit(submit)(event)} noValidate>
        <FormErrorSummary errors={fieldErrors} formErrors={apiErrors} />
        <FormSection title={t('identityStep')} variant="plain">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField htmlFor="client-name" label={t('name')} error={errors.name?.message} required><Input id="client-name" placeholder={t('namePlaceholder')} {...register('name')} /></FormField>
            <FormField htmlFor="client-type" label={t('clientType')}><ClientTypeSelect register={register} t={t} /></FormField>
          </div>
          <FormField htmlFor="client-notes" label={t('notes')}><Textarea id="client-notes" placeholder={t('notesPlaceholder')} {...register('notes')} /></FormField>
        </FormSection>
        <FormActions submitLabel={t('saveChanges')} isPending={mutation.isPending} cancelHref={`/clients/${client!.id}`} />
      </form>
    );
  }

  return (
    <div className="space-y-6">
      <StepIndicator step={step} labels={[t('identityStep'), t('contactStep')]} ariaLabel={t('progress')} />
      <form onSubmit={(event) => void handleSubmit(submit)(event)} className="space-y-6 pb-24" noValidate>
        {(fieldErrors.length || apiErrors.length) ? <FormErrorSummary errors={fieldErrors} formErrors={apiErrors} /> : null}
        {step === 1 ? (
          <FormSection title={t('identityStep')} description={t('identityDescription')} variant="plain">
            <div className="flex gap-2 rounded-control border border-border bg-surface-subtle px-3 py-2.5 text-sm text-muted-foreground"><Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{t('automaticCode')}</span></div>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField htmlFor="client-name" label={t('name')} hint={t('nameHint')} error={errors.name?.message} required><Input id="client-name" placeholder={t('namePlaceholder')} autoFocus {...register('name', { onChange: () => setAllowDuplicate(false) })} /></FormField>
              <FormField htmlFor="client-type" label={t('clientType')} required><ClientTypeSelect register={register} t={t} /></FormField>
            </div>
            {candidates.length > 0 ? <DuplicateWarning candidates={candidates} onContinue={() => setAllowDuplicate(true)} t={t} /> : null}
            <div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" onClick={() => isDirty ? setShowLeaveConfirm(true) : router.push('/clients')}>{t('cancel')}</Button><Button type="button" onClick={() => void trigger(['name', 'type']).then((valid) => valid && setStep(2))}>{t('next')}<ArrowRight size={16} className="ms-1.5 rtl:rotate-180" aria-hidden="true" /></Button></div>
          </FormSection>
        ) : (
          <FormSection title={t('contactStep')} description={t('contactDescription')} variant="plain">
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField htmlFor="client-contact-name" label={t('contactName')} error={errors.contactName?.message} required><Input id="client-contact-name" placeholder={t('contactNamePlaceholder')} {...register('contactName')} /></FormField>
              <FormField htmlFor="client-contact-role" label={t('contactRole')} error={errors.contactRole?.message}><Input id="client-contact-role" placeholder={t('contactRolePlaceholder')} {...register('contactRole')} /></FormField>
              <FormField htmlFor="client-contact-phone" label={t('contactPhone')} error={errors.contactPhone?.message}><Input id="client-contact-phone" type="tel" dir="ltr" placeholder={t('contactPhonePlaceholder')} {...register('contactPhone')} /></FormField>
              <FormField htmlFor="client-contact-email" label={t('contactEmail')} error={errors.contactEmail?.message}><Input id="client-contact-email" type="email" dir="ltr" placeholder={t('contactEmailPlaceholder')} {...register('contactEmail')} /></FormField>
            </div>
            <button type="button" className="flex min-h-11 items-center gap-2 text-sm font-medium text-foreground" aria-expanded={showNotes} onClick={() => setShowNotes((value) => !value)}><CaretDown size={16} className={showNotes ? '' : '-rotate-90 rtl:rotate-90'} aria-hidden="true" />{t('additionalInformation')}</button>
            {showNotes ? <FormField htmlFor="client-notes" label={t('notes')} hint={t('notesHint')}><Textarea id="client-notes" placeholder={t('notesPlaceholder')} {...register('notes')} /></FormField> : null}
            <div className="flex items-center justify-between gap-3"><Button type="button" variant="outline" onClick={() => setStep(1)}><ArrowLeft size={16} className="me-1.5 rtl:rotate-180" aria-hidden="true" />{t('back')}</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? t('creating') : t('submit')}</Button></div>
          </FormSection>
        )}
      </form>
      {showLeaveConfirm ? <ConfirmActionDialog title={tCommon('unsavedChanges.title')} description={tCommon('unsavedChanges.body')} confirmLabel={tCommon('unsavedChanges.leave')} isPending={false} onConfirm={() => router.push('/clients')} onDismiss={() => setShowLeaveConfirm(false)} /> : null}
    </div>
  );
}

function ClientTypeSelect({ register, t }: { register: ReturnType<typeof useForm<ClientFormValues>>['register']; t: ReturnType<typeof useTranslations<'platform.clients.create'>> }) {
  return <Select id="client-type" {...register('type')}><option value="COMPANY">{t('clientTypes.COMPANY')}</option><option value="GOVERNMENT">{t('clientTypes.GOVERNMENT')}</option><option value="NGO">{t('clientTypes.NGO')}</option><option value="INDIVIDUAL">{t('clientTypes.INDIVIDUAL')}</option><option value="OTHER">{t('clientTypes.OTHER')}</option></Select>;
}

function StepIndicator({ step, labels, ariaLabel }: { step: 1 | 2; labels: [string, string]; ariaLabel: string }) {
  return <nav aria-label={ariaLabel} className="flex items-center"><StepCircle n={1} label={labels[0]} state={step === 1 ? 'current' : 'done'} /><div className="mx-3 h-px flex-1 bg-border" /><StepCircle n={2} label={labels[1]} state={step === 2 ? 'current' : 'upcoming'} /></nav>;
}
function StepCircle({ n, label, state }: { n: number; label: string; state: 'current' | 'done' | 'upcoming' }) {
  return <div className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${state === 'done' ? 'bg-success text-white' : state === 'current' ? 'bg-brand-primary text-white' : 'bg-muted text-muted-foreground'}`}>{state === 'done' ? <Check size={14} weight="bold" aria-hidden="true" /> : n}</span><span className={`hidden text-sm font-medium sm:block ${state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground'}`}>{label}</span></div>;
}
function DuplicateWarning({ candidates, onContinue, t }: { candidates: Awaited<ReturnType<typeof findClientDuplicateCandidates>>; onContinue: () => void; t: ReturnType<typeof useTranslations<'platform.clients.create'>> }) {
  return <Alert variant="warning" messages={[t('possibleDuplicate')]}><div className="mt-3 space-y-2">{candidates.map((candidate) => <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2"><span className="text-sm font-medium text-foreground">{candidate.name}</span><Button asChild size="sm" variant="outline"><Link href={`/clients/${candidate.id}`} target="_blank">{t('openClient')}</Link></Button></div>)}<Button type="button" size="sm" variant="ghost" onClick={onContinue}>{t('continueAnyway')}</Button></div></Alert>;
}
