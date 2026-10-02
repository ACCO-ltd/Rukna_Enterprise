'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Users } from 'lucide-react';
import {
  Button,
  CheckboxField,
  Disclosure,
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
import { expectsBusinessEmail, isEmailFormat } from '@/lib/email-hints';
import { isPhoneEmpty, isValidPhone } from '@/lib/phone';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { CountrySelect } from '@/components/country-select';
import { EmailField } from '@/components/email-field';
import { FormErrorSummary, type FormFieldError } from '@/components/form-error-summary';
import { PhoneInput } from '@/components/phone-input';

import { findClientDuplicateCandidates } from '../api/clients-api';
import { clientErrorCode, emailFieldOf, phoneFieldOf } from '../client-errors';
import {
  EMPTY_CLIENT_FORM,
  toClientFormValues,
  toCreateClientPayload,
  toUpdateClientPayload,
  type ClientFormValues,
} from '../client-form-payload';
import { useCreateClient, useUpdateClient } from '../hooks/use-client';
import { CLIENT_TYPES, type Client } from '../types';

interface ClientFormProps {
  client?: Client;
  onCreated?: (client: Client) => void;
  onCancel?: () => void;
}

type ClientCreateT = ReturnType<typeof useTranslations<'platform.clients.create'>>;

const phoneSchema = z.object({ country: z.string(), number: z.string() });

/**
 * Create and edit a client — the ADR-037 create page.
 *
 * Sticky action bar → error summary when a save failed → the record header (the name, set
 * large) → "* Required" → Identity → Primary contact (create only) → Address → Billing, with
 * internal notes folded behind a disclosure. One page, not a wizard: the fields have no
 * dependency on each other beyond the client type.
 *
 * Client type shapes the form: an individual's name reads "Full name" and has no job title,
 * and an organisation's personal webmail address gets a (non-blocking) warning.
 *
 * Contacts belong to creation only. On an existing client they are managed on the record, so
 * a second contact editor here would be two ways to change one thing.
 *
 * Three hosts: /clients/new, the edit page, and inline inside the project form (`onCreated` /
 * `onCancel`), where saving hands the new client back instead of navigating.
 */
export function ClientForm({ client, onCreated, onCancel }: ClientFormProps = {}) {
  const t = useTranslations('platform.clients.create');
  const tErrors = useTranslations('platform.clients.errors');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();
  const isEdit = Boolean(client);
  const isInline = Boolean(onCreated || onCancel);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [notesOpen, setNotesOpen] = useState(Boolean(client?.notes));

  const optionalEmail = (message: string) =>
    z.string().refine((value) => value.trim() === '' || isEmailFormat(value), message);

  const schema = z
    .object({
      name: z.string().trim().min(1, t('nameRequired')).max(255, t('nameTooLong')),
      type: z.enum(['COMPANY', 'GOVERNMENT', 'NGO', 'INDIVIDUAL', 'OTHER']),
      registrationNumber: z.string().trim().max(50, t('registrationNumberTooLong')),
      taxNumber: z.string().trim().max(50, t('taxNumberTooLong')),
      contactName: z.string().trim().max(255, t('nameTooLong')),
      contactRole: z.string().trim().max(100, t('contactRoleTooLong')),
      contactPhone: phoneSchema,
      whatsappSame: z.boolean(),
      contactWhatsapp: phoneSchema,
      contactEmail: optionalEmail(tCommon('email.invalid')),
      countryCode: z.string(),
      city: z.string().trim().max(100, t('cityTooLong')),
      address: z.string().trim().max(500, t('addressTooLong')),
      invoiceEmail: optionalEmail(tCommon('email.invalid')),
      paymentTermsDays: z
        .string()
        .trim()
        .refine(
          (value) => value === '' || (/^\d+$/.test(value) && Number(value) <= 365),
          t('paymentTermsInvalid'),
        ),
      notes: z.string().trim().max(2000, t('notesTooLong')),
    })
    .superRefine((values, ctx) => {
      if (isEdit) return;
      // An individual client is their own contact: the full name above is the contact's name.
      if (values.type !== 'INDIVIDUAL' && !values.contactName.trim()) {
        ctx.addIssue({ code: 'custom', path: ['contactName'], message: t('contactNameRequired') });
      }
      if (isPhoneEmpty(values.contactPhone)) {
        ctx.addIssue({ code: 'custom', path: ['contactPhone'], message: tCommon('phone.required') });
      } else if (!isValidPhone(values.contactPhone)) {
        ctx.addIssue({ code: 'custom', path: ['contactPhone'], message: tCommon('phone.invalid') });
      }
      if (!values.whatsappSame && !isPhoneEmpty(values.contactWhatsapp) && !isValidPhone(values.contactWhatsapp)) {
        ctx.addIssue({ code: 'custom', path: ['contactWhatsapp'], message: tCommon('phone.invalid') });
      }
    });

  const create = useCreateClient();
  const update = useUpdateClient(client?.id ?? '');
  const mutation = isEdit ? update : create;
  const form = useForm<ClientFormValues>({
    resolver: zodResolver(schema),
    defaultValues: client ? toClientFormValues(client) : EMPTY_CLIENT_FORM,
  });
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isDirty },
  } = form;
  const name = useWatch({ control, name: 'name' });
  const type = useWatch({ control, name: 'type' });
  const whatsappSame = useWatch({ control, name: 'whatsappSame' });
  const isIndividual = type === 'INDIVIDUAL';
  const warnPersonal = expectsBusinessEmail(type);

  const duplicateQuery = useQuery({
    queryKey: ['clients', 'duplicate-candidates', name.trim()],
    queryFn: () => findClientDuplicateCandidates(name.trim()),
    enabled: !isEdit && name.trim().length >= 3,
    staleTime: 30_000,
  });
  // A warning, not an error (ADR-037): two clients can legitimately share a name.
  const candidates = duplicateQuery.data ?? [];

  useEffect(() => {
    if (!isDirty || mutation.isSuccess) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, mutation.isSuccess]);

  const nameLabel = isIndividual ? t('fullName') : t('clientName');
  const fieldErrors: FormFieldError[] = [
    errors.name ? { label: nameLabel, fieldId: 'client-name', message: errors.name.message! } : null,
    errors.registrationNumber ? { label: t('registrationNumber'), fieldId: 'client-registration-number', message: errors.registrationNumber.message! } : null,
    errors.taxNumber ? { label: t('taxId'), fieldId: 'client-tax-number', message: errors.taxNumber.message! } : null,
    errors.contactName ? { label: t('contactName'), fieldId: 'client-contact-name', message: errors.contactName.message! } : null,
    errors.contactRole ? { label: t('contactRole'), fieldId: 'client-contact-role', message: errors.contactRole.message! } : null,
    errors.contactPhone ? { label: t('contactPhone'), fieldId: 'client-contact-phone', message: errors.contactPhone.message! } : null,
    errors.contactWhatsapp ? { label: t('whatsappNumber'), fieldId: 'client-contact-whatsapp', message: errors.contactWhatsapp.message! } : null,
    errors.contactEmail ? { label: t('contactEmail'), fieldId: 'client-contact-email', message: errors.contactEmail.message! } : null,
    errors.city ? { label: t('city'), fieldId: 'client-city', message: errors.city.message! } : null,
    errors.address ? { label: t('address'), fieldId: 'client-address', message: errors.address.message! } : null,
    errors.invoiceEmail ? { label: t('invoiceEmail'), fieldId: 'client-invoice-email', message: errors.invoiceEmail.message! } : null,
    errors.paymentTermsDays ? { label: t('paymentTerms'), fieldId: 'client-payment-terms', message: errors.paymentTermsDays.message! } : null,
    errors.notes ? { label: t('notes'), fieldId: 'client-notes', message: errors.notes.message! } : null,
  ].filter(Boolean) as FormFieldError[];

  // A field-specific server error is shown at its field (applied in `onServerError`), so the
  // summary only carries the failures that belong to no field.
  const code = clientErrorCode(mutation.error);
  const apiErrors =
    mutation.error && code !== 'PHONE_INVALID' && code !== 'EMAIL_INVALID'
      ? [code ? tErrors(code) : mutation.error instanceof ApiError ? mutation.error.message : t('failed')]
      : [];
  const hasSummary = fieldErrors.length > 0 || apiErrors.length > 0;

  const discardHref = isEdit ? `/clients/${client!.id}` : '/clients';
  const leave = () => (onCancel ? onCancel() : router.push(discardHref));
  const discard = () => (isDirty ? setShowLeaveConfirm(true) : leave());

  const saveState: FormSaveState = isDirty ? 'dirty' : isEdit ? 'clean' : 'new';

  const onServerError = (error: unknown) => {
    const errorCode = clientErrorCode(error);
    if (errorCode === 'PHONE_INVALID') {
      const field = phoneFieldOf(error) === 'whatsapp' ? 'contactWhatsapp' : 'contactPhone';
      setError(field, { message: tErrors('PHONE_INVALID') }, { shouldFocus: true });
    } else if (errorCode === 'EMAIL_INVALID') {
      setError(emailFieldOf(error), { message: tErrors('EMAIL_INVALID') }, { shouldFocus: true });
    }
  };

  const submit = (values: ClientFormValues) => {
    if (mutation.isPending) return;
    if (isEdit && client) {
      update.mutate(toUpdateClientPayload(values), { onError: onServerError });
      return;
    }
    create.mutate(toCreateClientPayload(values), {
      onError: onServerError,
      onSuccess: (created) => {
        if (onCreated) {
          onCreated(created);
          return;
        }
        toast({
          tone: 'success',
          title: t('createdToast'),
          description: `${created.name} · ${created.code}`,
          duration: 9000,
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
          back={
            isInline ? undefined : (
              <Button asChild variant="ghost" className="gap-1.5 px-2">
                <Link href="/clients">
                  <ArrowLeft size={16} aria-hidden="true" />
                  {t('backToList')}
                </Link>
              </Button>
            )
          }
          save={
            <Button type="submit" loading={mutation.isPending} loadingText={t('saving')}>
              {t('save')}
            </Button>
          }
          discard={
            <Button type="button" variant="ghost" onClick={discard} disabled={mutation.isPending}>
              {t('discard')}
            </Button>
          }
          saveState={saveState}
          saveStateLabels={{ new: tCommon('formState.new'), dirty: tCommon('formState.dirty'), clean: tCommon('formState.clean') }}
        />

        <div className="space-y-8">
          {hasSummary ? <FormErrorSummary errors={fieldErrors} formErrors={apiErrors} /> : null}

          <div className="space-y-3">
            <RecordCreateHeader icon={<Users size={20} />}>
              <FormField
                htmlFor="client-name"
                label={nameLabel}
                hint={t('clientNameHint')}
                error={errors.name?.message}
                warning={candidates.length > 0 ? t('possibleDuplicate') : undefined}
                required
              >
                <Input
                  id="client-name"
                  className={RECORD_NAME_INPUT}
                  placeholder={isIndividual ? t('fullNamePlaceholder') : t('namePlaceholder')}
                  autoFocus={!isEdit}
                  {...register('name')}
                />
              </FormField>
              {candidates.length > 0 ? <DuplicateLinks candidates={candidates} t={t} /> : null}
            </RecordCreateHeader>
            <RequiredNote label={tCommon('required')} />
          </div>

          <FormGroup title={t('identityGroup')} description={t('identityGroupHint')}>
            <FormField htmlFor="client-type" label={t('clientType')} required>
              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <Select id="client-type" value={field.value} onChange={field.onChange}>
                    {CLIENT_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {t(`clientTypes.${value}`)}
                      </option>
                    ))}
                  </Select>
                )}
              />
            </FormField>
            {isEdit ? (
              <FormField htmlFor="client-code" label={t('code')}>
                <Input id="client-code" readOnly value={client?.code ?? ''} className="bg-muted text-muted-foreground" />
              </FormField>
            ) : null}
            <FormField htmlFor="client-registration-number" label={t('registrationNumber')} error={errors.registrationNumber?.message}>
              <Input id="client-registration-number" placeholder={t('registrationNumberPlaceholder')} {...register('registrationNumber')} />
            </FormField>
            <FormField htmlFor="client-tax-number" label={t('taxId')} error={errors.taxNumber?.message}>
              <Input id="client-tax-number" placeholder={t('taxIdPlaceholder')} {...register('taxNumber')} />
            </FormField>
          </FormGroup>

          {isEdit ? null : (
            <FormGroup title={t('contactGroup')} description={t('contactGroupHint')}>
              {isIndividual ? null : (
                <FormField htmlFor="client-contact-name" label={t('contactName')} error={errors.contactName?.message} required>
                  <Input id="client-contact-name" placeholder={t('contactNamePlaceholder')} {...register('contactName')} />
                </FormField>
              )}
              {isIndividual ? null : (
                <FormField htmlFor="client-contact-role" label={t('contactRole')} error={errors.contactRole?.message}>
                  <Input id="client-contact-role" placeholder={t('contactRolePlaceholder')} {...register('contactRole')} />
                </FormField>
              )}
              <FormField htmlFor="client-contact-phone" label={t('contactPhone')} error={errors.contactPhone?.message} required>
                <Controller
                  control={control}
                  name="contactPhone"
                  render={({ field }) => (
                    <PhoneInput
                      id="client-contact-phone"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      invalid={Boolean(errors.contactPhone)}
                    />
                  )}
                />
              </FormField>
              <Controller
                control={control}
                name="contactEmail"
                render={({ field }) => (
                  <EmailField
                    id="client-contact-email"
                    label={t('contactEmail')}
                    placeholder={t('contactEmailPlaceholder')}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    error={errors.contactEmail?.message}
                    warnPersonal={warnPersonal}
                  />
                )}
              />
              <div className="sm:col-span-2">
                <Controller
                  control={control}
                  name="whatsappSame"
                  render={({ field }) => (
                    <CheckboxField
                      id="client-whatsapp-same"
                      label={t('whatsappSame')}
                      checked={field.value}
                      onChange={(event) => field.onChange(event.target.checked)}
                    />
                  )}
                />
              </div>
              {whatsappSame ? null : (
                <FormField htmlFor="client-contact-whatsapp" label={t('whatsappNumber')} hint={t('whatsappNumberHint')} error={errors.contactWhatsapp?.message}>
                  <Controller
                    control={control}
                    name="contactWhatsapp"
                    render={({ field }) => (
                      <PhoneInput
                        id="client-contact-whatsapp"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        invalid={Boolean(errors.contactWhatsapp)}
                      />
                    )}
                  />
                </FormField>
              )}
            </FormGroup>
          )}

          <FormGroup title={t('addressGroup')} description={t('addressGroupHint')}>
            <FormField htmlFor="client-country" label={t('country')}>
              <Controller
                control={control}
                name="countryCode"
                render={({ field }) => <CountrySelect id="client-country" value={field.value} onChange={field.onChange} />}
              />
            </FormField>
            <FormField htmlFor="client-city" label={t('city')} error={errors.city?.message}>
              <Input id="client-city" placeholder={t('cityPlaceholder')} {...register('city')} />
            </FormField>
            <FormField htmlFor="client-address" label={t('address')} error={errors.address?.message} className="sm:col-span-2">
              <Input id="client-address" placeholder={t('addressPlaceholder')} {...register('address')} />
            </FormField>
          </FormGroup>

          <FormGroup title={t('billingGroup')} description={t('billingGroupHint')}>
            <Controller
              control={control}
              name="invoiceEmail"
              render={({ field }) => (
                <EmailField
                  id="client-invoice-email"
                  label={t('invoiceEmail')}
                  hint={t('invoiceEmailHint')}
                  placeholder={t('invoiceEmailPlaceholder')}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.invoiceEmail?.message}
                  warnPersonal={warnPersonal}
                />
              )}
            />
            <FormField htmlFor="client-payment-terms" label={t('paymentTerms')} hint={t('paymentTermsHint')} error={errors.paymentTermsDays?.message}>
              <Input id="client-payment-terms" inputMode="numeric" placeholder={t('paymentTermsPlaceholder')} {...register('paymentTermsDays')} />
            </FormField>
          </FormGroup>

          {/* An error inside the notes must not stay hidden behind a closed toggle. */}
          <Disclosure
            label={t('notesSection')}
            hint={t('notesDescription')}
            open={notesOpen || Boolean(errors.notes)}
            onOpenChange={setNotesOpen}
          >
            <div className="pt-4">
              <FormField htmlFor="client-notes" label={t('notes')} hint={t('notesHint')} error={errors.notes?.message}>
                <Textarea id="client-notes" placeholder={t('notesPlaceholder')} {...register('notes')} />
              </FormField>
            </div>
          </Disclosure>
        </div>
      </form>

      {showLeaveConfirm ? (
        <ConfirmActionDialog
          title={tCommon('unsavedChanges.title')}
          description={tCommon('unsavedChanges.body')}
          confirmLabel={tCommon('unsavedChanges.leave')}
          isPending={false}
          onConfirm={leave}
          onDismiss={() => setShowLeaveConfirm(false)}
        />
      ) : null}
    </>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

/** "* Required" — the one line that says what the asterisks mean. */
export function RequiredNote({ label }: { label: string }) {
  return (
    <p className="text-caption text-muted-foreground">
      <span className="me-0.5 text-danger" aria-hidden="true">
        *
      </span>
      {label}
    </p>
  );
}

/** The possible duplicates behind the name field's warning, each opening in a new tab. */
function DuplicateLinks({
  candidates,
  t,
}: {
  candidates: Awaited<ReturnType<typeof findClientDuplicateCandidates>>;
  t: ClientCreateT;
}) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-caption" aria-label={t('possibleDuplicate')}>
      {candidates.map((candidate) => (
        <li key={candidate.id}>
          <Link
            href={`/clients/${candidate.id}`}
            target="_blank"
            className="font-medium text-brand-primary underline-offset-2 hover:underline"
          >
            {t('openClient')}: {candidate.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
