'use client';

import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';

import type { AddContactPayload } from '../api/clients-api';
import { useAddContact, useRemoveContact } from '../hooks/use-client';
import type { ClientContact } from '../types';

interface ClientContactsProps {
  clientId: string;
  contacts: ClientContact[];
}

export function ClientContacts({ clientId, contacts }: ClientContactsProps) {
  const t = useTranslations('platform.clients.contacts');
  const [isAdding, setIsAdding] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<ClientContact | null>(null);

  const remove = useRemoveContact(clientId);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
        <Button
          size="sm"
          onClick={() => {
            setIsAdding(true);
          }}
        >
          {t('add')}
        </Button>
      </div>

      {contacts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{t('none')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{contact.name}</span>
                  {contact.isPrimary ? <Badge tone="info">{t('primary')}</Badge> : null}
                </div>
                {contact.role ? (
                  <p className="text-xs text-muted-foreground">{contact.role}</p>
                ) : null}
                <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground sm:flex-row sm:gap-4">
                  {/* mailto/tel so a site manager can act on the contact from a phone
                      rather than copying digits by hand. `dir="ltr"` keeps a phone number
                      or address readable when the page is Arabic. */}
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className="truncate hover:underline" dir="ltr">
                      {contact.email}
                    </a>
                  ) : null}
                  {contact.phone ? (
                    <a href={`tel:${contact.phone}`} className="hover:underline" dir="ltr">
                      {contact.phone}
                    </a>
                  ) : null}
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPendingRemoval(contact);
                }}
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {isAdding ? (
        <AddContactDialog
          clientId={clientId}
          hasPrimary={contacts.some((c) => c.isPrimary)}
          onClose={() => {
            setIsAdding(false);
          }}
        />
      ) : null}

      {pendingRemoval ? (
        <ConfirmActionDialog
          title={t('removeTitle')}
          description={`${pendingRemoval.name} — ${t('removeBody')}`}
          confirmLabel={t('remove')}
          isPending={remove.isPending}
          errorMessage={remove.isError ? t('removeFailed') : undefined}
          onConfirm={() => {
            remove.mutate(pendingRemoval.id, {
              onSuccess: () => {
                setPendingRemoval(null);
              },
            });
          }}
          onDismiss={() => {
            remove.reset();
            setPendingRemoval(null);
          }}
        />
      ) : null}
    </section>
  );
}

interface AddContactDialogProps {
  clientId: string;
  /** Drives the demotion warning — there is nothing to demote when no primary exists. */
  hasPrimary: boolean;
  onClose: () => void;
}

interface ContactFormValues {
  name: string;
  role: string;
  email: string;
  phone: string;
  isPrimary: boolean;
}

function AddContactDialog({ clientId, hasPrimary, onClose }: AddContactDialogProps) {
  const t = useTranslations('platform.clients.contacts');
  const tCommon = useTranslations('common');
  const add = useAddContact(clientId);

  // `email` mirrors the DTO's `@IsEmail()`. The other fields are unconstrained
  // server-side, so nothing is invented here that the API would not enforce.
  const schema = z.object({
    name: z.string().trim().min(1, t('nameRequired')),
    role: z.string(),
    email: z.string().refine((v) => v.trim() === '' || z.email().safeParse(v.trim()).success, {
      message: t('emailInvalid'),
    }),
    phone: z.string(),
    isPrimary: z.boolean(),
  });

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', role: '', email: '', phone: '', isPrimary: false },
  });

  // `useWatch` rather than the `watch()` returned by useForm: the latter is a function
  // the React Compiler cannot memoize, so it opts the whole component out of compilation.
  const isPrimary = useWatch({ control, name: 'isPrimary' });
  const willDemote = isPrimary && hasPrimary;

  const onSubmit = (values: ContactFormValues) => {
    // Empty optional fields are omitted, not sent as "" — `@IsEmail()` rejects an empty
    // string, and a blank phone should be NULL rather than a stored empty value.
    const payload: AddContactPayload = { name: values.name.trim() };
    const optional = { role: values.role, email: values.email, phone: values.phone } as const;
    for (const [key, value] of Object.entries(optional)) {
      const trimmed = value.trim();
      if (trimmed) payload[key as keyof typeof optional] = trimmed;
    }
    if (values.isPrimary) payload.isPrimary = true;

    add.mutate(payload, { onSuccess: onClose });
  };

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
          {add.isError ? <Alert variant="error" messages={[t('addFailed')]} /> : null}

          <FormField htmlFor="contact-name" label={t('name')} error={errors.name?.message}>
            <Input id="contact-name" aria-invalid={Boolean(errors.name)} {...register('name')} />
          </FormField>

          <FormField htmlFor="contact-role" label={t('role')}>
            <Input id="contact-role" {...register('role')} />
          </FormField>

          <FormField htmlFor="contact-email" label={t('email')} error={errors.email?.message}>
            <Input
              id="contact-email"
              type="email"
              dir="ltr"
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
          </FormField>

          <FormField htmlFor="contact-phone" label={t('phone')}>
            <Input id="contact-phone" type="tel" dir="ltr" {...register('phone')} />
          </FormField>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="size-4 rounded border-border text-brand-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
                {...register('isPrimary')}
              />
              {t('isPrimary')}
            </label>
            {/* The API demotes the existing primary in the same request. That is a change
                to a record the user did not name, so it is stated before they submit
                rather than discovered afterwards. */}
            {willDemote ? (
              <p className="text-xs text-warning">{t('isPrimaryHint')}</p>
            ) : null}
          </div>

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
