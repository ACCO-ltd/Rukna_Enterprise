'use client';

import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  CheckboxField,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
} from '@erp/ui';

import { EmailField } from '@/components/email-field';
import { PhoneInput } from '@/components/phone-input';
import { ApiError } from '@/lib/api-client';
import { isEmailFormat, normalizeEmail } from '@/lib/email-hints';
import {
  EMPTY_PHONE,
  fromE164,
  isPhoneEmpty,
  isValidPhone,
  toE164,
  type PhoneValue,
} from '@/lib/phone';

import { clientErrorCode, phoneFieldOf } from '../client-errors';
import { normalizeName } from '../client-form-payload';
import { useAddContact, useUpdateContact } from '../hooks/use-client';
import type { AddContactPayload, ClientContact, UpdateContactPayload } from '../types';

export interface ContactFormValues {
  name: string;
  role: string;
  phone: PhoneValue;
  /** "Use this number for WhatsApp". */
  whatsappSame: boolean;
  whatsapp: PhoneValue;
  email: string;
  isPrimary: boolean;
}

/** Edit form defaults: WhatsApp counts as "same" when it is unset or equal to the phone. */
export function toContactFormValues(contact?: ClientContact): ContactFormValues {
  if (!contact) {
    return {
      name: '',
      role: '',
      phone: { ...EMPTY_PHONE },
      whatsappSame: true,
      whatsapp: { ...EMPTY_PHONE },
      email: '',
      isPrimary: false,
    };
  }
  const separate = Boolean(contact.whatsappPhone) && contact.whatsappPhone !== contact.phone;
  return {
    name: contact.name,
    role: contact.role ?? '',
    phone: fromE164(contact.phone),
    // "Same as phone" only when it is: a contact saved before WhatsApp numbers existed has none, and
    // editing its name must not quietly start sending it WhatsApp messages.
    whatsappSame: contact.whatsappPhone !== null && contact.whatsappPhone === contact.phone,
    whatsapp: separate ? fromE164(contact.whatsappPhone) : { ...EMPTY_PHONE },
    email: contact.email ?? '',
    isPrimary: contact.isPrimary,
  };
}

function whatsappOf(values: ContactFormValues, phone: string): string | null {
  if (values.whatsappSame) return phone;
  return isPhoneEmpty(values.whatsapp) ? null : toE164(values.whatsapp);
}

/** Add body: E.164 phones, optional fields omitted when blank. */
export function toAddContactPayload(values: ContactFormValues): AddContactPayload {
  const phone = toE164(values.phone) ?? values.phone.number.trim();
  const whatsapp = whatsappOf(values, phone);
  const role = values.role.trim();
  const email = normalizeEmail(values.email);
  return {
    name: normalizeName(values.name),
    phone,
    ...(role ? { role } : {}),
    ...(whatsapp ? { whatsappPhone: whatsapp } : {}),
    ...(email ? { email } : {}),
    ...(values.isPrimary ? { isPrimary: true } : {}),
  };
}

/** Edit body: a cleared optional field is sent as `null` (PATCH omission means "unchanged"). */
export function toUpdateContactPayload(values: ContactFormValues): UpdateContactPayload {
  const phone = toE164(values.phone) ?? values.phone.number.trim();
  return {
    name: normalizeName(values.name),
    role: values.role.trim() || null,
    phone,
    whatsappPhone: whatsappOf(values, phone),
    email: normalizeEmail(values.email) || null,
  };
}

interface ContactDialogProps {
  clientId: string;
  /** Omit to add a contact. */
  contact?: ClientContact;
  /** The client has no contacts yet — the first one is always primary, so the checkbox is not offered. */
  isFirst?: boolean;
  onClose: () => void;
}

/**
 * Add or edit a client contact — a FormDialog (ADR-039: no side sheets). Phone is required and
 * validated per country; WhatsApp is the same number unless the person says otherwise.
 */
export function ContactDialog({ clientId, contact, isFirst = false, onClose }: ContactDialogProps) {
  const t = useTranslations('platform.clients.contacts');
  const tErrors = useTranslations('platform.clients.errors');
  const tCommon = useTranslations('common');
  const isEdit = Boolean(contact);
  const add = useAddContact(clientId);
  const update = useUpdateContact(clientId);
  const mutation = isEdit ? update : add;

  const phone = z.object({ country: z.string(), number: z.string() });
  const schema = z
    .object({
      name: z.string().trim().min(1, t('nameRequired')).max(255, t('nameTooLong')),
      role: z.string().trim().max(100, t('roleTooLong')),
      phone,
      whatsappSame: z.boolean(),
      whatsapp: phone,
      email: z
        .string()
        .refine((value) => value.trim() === '' || isEmailFormat(value), tCommon('email.invalid')),
      isPrimary: z.boolean(),
    })
    .superRefine((values, ctx) => {
      if (isPhoneEmpty(values.phone)) {
        ctx.addIssue({ code: 'custom', path: ['phone'], message: tCommon('phone.required') });
      } else if (!isValidPhone(values.phone)) {
        ctx.addIssue({ code: 'custom', path: ['phone'], message: tCommon('phone.invalid') });
      }
      if (
        !values.whatsappSame &&
        !isPhoneEmpty(values.whatsapp) &&
        !isValidPhone(values.whatsapp)
      ) {
        ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: tCommon('phone.invalid') });
      }
    });

  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(schema),
    defaultValues: toContactFormValues(contact),
  });
  const whatsappSame = useWatch({ control, name: 'whatsappSame' });
  const isPrimary = useWatch({ control, name: 'isPrimary' });

  const code = clientErrorCode(mutation.error);
  const formError =
    mutation.error && code !== 'PHONE_INVALID' && code !== 'EMAIL_INVALID'
      ? code
        ? tErrors(code)
        : mutation.error instanceof ApiError
          ? mutation.error.message
          : isEdit
            ? t('saveFailed')
            : t('addFailed')
      : null;

  const onServerError = (error: unknown) => {
    const errorCode = clientErrorCode(error);
    if (errorCode === 'PHONE_INVALID') {
      setError(phoneFieldOf(error) === 'whatsapp' ? 'whatsapp' : 'phone', {
        message: tErrors('PHONE_INVALID'),
      });
    } else if (errorCode === 'EMAIL_INVALID') {
      setError('email', { message: tErrors('EMAIL_INVALID') });
    }
  };

  const onSubmit = (values: ContactFormValues) => {
    if (mutation.isPending) return;
    if (contact) {
      update.mutate(
        { contactId: contact.id, payload: toUpdateContactPayload(values) },
        { onSuccess: onClose, onError: onServerError },
      );
    } else {
      add.mutate(toAddContactPayload(values), { onSuccess: onClose, onError: onServerError });
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={isEdit ? t('editTitle') : t('add')}
      size="md"
      dirty={isDirty}
      busy={mutation.isPending}
      closeLabel={tCommon('close')}
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event);
      }}
    >
      <FormDialogBody className="space-y-4">
        {formError ? <Alert variant="error" messages={[formError]} /> : null}

        <FormField htmlFor="contact-name" label={t('name')} error={errors.name?.message} required>
          <Input id="contact-name" autoComplete="name" {...register('name')} />
        </FormField>

        <FormField htmlFor="contact-role" label={t('role')} error={errors.role?.message}>
          <Input id="contact-role" placeholder={t('rolePlaceholder')} {...register('role')} />
        </FormField>

        <FormField
          htmlFor="contact-phone"
          label={t('phone')}
          error={errors.phone?.message}
          required
        >
          <Controller
            control={control}
            name="phone"
            render={({ field }) => (
              <PhoneInput
                id="contact-phone"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={Boolean(errors.phone)}
              />
            )}
          />
        </FormField>

        <Controller
          control={control}
          name="whatsappSame"
          render={({ field }) => (
            <CheckboxField
              id="contact-whatsapp-same"
              label={t('whatsappSame')}
              checked={field.value}
              onChange={(event) => field.onChange(event.target.checked)}
            />
          )}
        />

        {whatsappSame ? null : (
          <FormField
            htmlFor="contact-whatsapp"
            label={t('whatsapp')}
            hint={t('whatsappHint')}
            error={errors.whatsapp?.message}
          >
            <Controller
              control={control}
              name="whatsapp"
              render={({ field }) => (
                <PhoneInput
                  id="contact-whatsapp"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  invalid={Boolean(errors.whatsapp)}
                />
              )}
            />
          </FormField>
        )}

        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <EmailField
              id="contact-email"
              label={t('email')}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={errors.email?.message}
            />
          )}
        />

        {/* Add only. The API demotes the current primary in the same request — a change to a
            record the user did not name, so it is said before they submit. */}
        {isEdit || isFirst ? null : (
          <CheckboxField
            id="contact-is-primary"
            label={t('isPrimary')}
            description={
              isPrimary ? <span className="text-warning">{t('isPrimaryHint')}</span> : undefined
            }
            {...register('isPrimary')}
          />
        )}
        {!isEdit && isFirst ? (
          <p className="text-caption text-muted-foreground">{t('firstIsPrimary')}</p>
        ) : null}
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={mutation.isPending}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" loading={mutation.isPending} loadingText={tCommon('saving')}>
          {isEdit ? t('saveChanges') : t('save')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
