'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  ContactList,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  OverflowGlyph,
  RecordPanel,
  type ContactChannel,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { formatPhone, telHref, whatsappHref } from '@/lib/phone';

import { clientErrorCode } from '../client-errors';
import { useMakeContactPrimary, useRemoveContact } from '../hooks/use-client';
import type { ClientContact } from '../types';
import { ContactDialog } from './contact-dialog';

interface ClientContactsProps {
  clientId: string;
  contacts: ClientContact[];
  canManage?: boolean;
}

type Editing = { mode: 'add' } | { mode: 'edit'; contact: ClientContact } | null;

/** Primary first, then oldest first — the order people were added in. */
function ordered(contacts: ClientContact[]): ClientContact[] {
  return [...contacts].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  });
}

/**
 * The Contacts panel on the client record: one row per person with phone, email and WhatsApp
 * as links, a kebab per row (Edit · Make primary · Remove…), and "Add contact" in the header.
 * The primary contact has no Remove — another contact must be made primary first, which is
 * exactly what the API enforces (`CONTACT_IS_PRIMARY`).
 */
export function ClientContacts({ clientId, contacts, canManage = false }: ClientContactsProps) {
  const t = useTranslations('platform.clients.contacts');
  const tErrors = useTranslations('platform.clients.errors');
  const [editing, setEditing] = useState<Editing>(null);
  const [pendingRemoval, setPendingRemoval] = useState<ClientContact | null>(null);
  const remove = useRemoveContact(clientId);
  const makePrimary = useMakeContactPrimary(clientId);
  const sorted = ordered(contacts);
  const byId = new Map(sorted.map((contact) => [contact.id, contact]));

  const channels = (contact: ClientContact): ContactChannel[] => {
    const list: ContactChannel[] = [];
    if (contact.phone) list.push({ key: 'phone', label: formatPhone(contact.phone) ?? contact.phone, href: telHref(contact.phone) });
    if (contact.email) list.push({ key: 'email', label: contact.email, href: `mailto:${contact.email}` });
    if (contact.whatsappPhone) {
      list.push({
        key: 'whatsapp',
        label: t('whatsappLink'),
        href: whatsappHref(contact.whatsappPhone),
        external: true,
        'aria-label': t('whatsappLabel', { name: contact.name }),
      });
    }
    return list;
  };

  const removeError = remove.error
    ? clientErrorCode(remove.error) === 'CONTACT_IS_PRIMARY'
      ? tErrors('CONTACT_IS_PRIMARY')
      : t('removeFailed')
    : undefined;

  return (
    <RecordPanel
      title={t('headingWithCount', { count: contacts.length })}
      padded={false}
      action={
        canManage ? (
          <Button variant="outline" size="sm" onClick={() => setEditing({ mode: 'add' })}>
            {t('add')}
          </Button>
        ) : undefined
      }
    >
      <ContactList
        label={t('heading')}
        primaryLabel={t('primary')}
        contacts={sorted.map((contact) => ({
          id: contact.id,
          name: contact.name,
          role: contact.role,
          primary: contact.isPrimary,
          channels: channels(contact),
        }))}
        empty={<EmptyState variant="inline" title={t('none')} description={t('noneHint')} />}
        actions={
          canManage
            ? (item) => {
                const contact = byId.get(item.id)!;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t('rowMenu', { name: contact.name })}>
                        <OverflowGlyph />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing({ mode: 'edit', contact })}>{t('edit')}</DropdownMenuItem>
                      {contact.isPrimary ? null : (
                        <>
                          <DropdownMenuItem onSelect={() => makePrimary.mutate(contact.id)} disabled={makePrimary.isPending}>
                            {t('makePrimary')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={() => setPendingRemoval(contact)}>
                            {t('removeEllipsis')}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              }
            : undefined
        }
      />

      {makePrimary.isError ? (
        <p role="alert" className="border-t border-border px-4 py-2 text-caption text-danger">
          {t('makePrimaryFailed')}
        </p>
      ) : null}

      {editing ? (
        <ContactDialog
          clientId={clientId}
          contact={editing.mode === 'edit' ? editing.contact : undefined}
          isFirst={contacts.length === 0}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {pendingRemoval ? (
        <ConfirmActionDialog
          title={t('removeTitle', { name: pendingRemoval.name })}
          description={t('removeBody')}
          confirmLabel={t('remove')}
          destructive
          isPending={remove.isPending}
          errorMessage={removeError}
          onConfirm={() =>
            remove.mutate(pendingRemoval.id, {
              onSuccess: () => setPendingRemoval(null),
            })
          }
          onDismiss={() => {
            remove.reset();
            setPendingRemoval(null);
          }}
        />
      ) : null}
    </RecordPanel>
  );
}
