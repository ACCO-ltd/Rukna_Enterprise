import * as React from 'react';

import { cn } from '../lib/utils';
import { Avatar } from './avatar';
import { Badge } from './badge';

export interface ContactChannel {
  key: string;
  /** What is read — a formatted phone number, an address, "WhatsApp". */
  label: string;
  /** `tel:`, `mailto:` or an https link. */
  href: string;
  /** Opens in a new tab (an https link such as WhatsApp click-to-chat). */
  external?: boolean;
  /** Spoken name when `label` alone is ambiguous — "WhatsApp Amina Ali". */
  'aria-label'?: string;
}

export interface ContactListItem {
  id: string;
  name: string;
  role?: string | null;
  /** The one primary contact. Badged; the caller decides what that removes from its actions. */
  primary?: boolean;
  /** Ways to reach the person, already formatted, each a link. Empty ones are left out. */
  channels: ContactChannel[];
}

export interface ContactListProps {
  contacts: readonly ContactListItem[];
  /** Badge text on the primary contact — "Primary". */
  primaryLabel: string;
  /** Trailing control per row — usually a kebab. */
  actions?: (contact: ContactListItem) => React.ReactNode;
  /** Shown instead of the list when there are no contacts. */
  empty?: React.ReactNode;
  /** Accessible name for the list. */
  label?: string;
  className?: string;
}

/**
 * The people on a record (a client, a supplier): name, role, a Primary badge, and their phone /
 * email / WhatsApp as real links — so someone on site can call from a phone rather than copy
 * digits. Router-agnostic and copy-free: the caller formats every value and supplies the words.
 *
 * Rows, not cards, separated by hairlines; it sits flush inside a `RecordPanel padded={false}`.
 */
export function ContactList({
  contacts,
  primaryLabel,
  actions,
  empty,
  label,
  className,
}: ContactListProps) {
  if (contacts.length === 0) return <>{empty ?? null}</>;
  return (
    <ul aria-label={label} className={cn('divide-y divide-border', className)}>
      {contacts.map((contact) => (
        <li key={contact.id} className="flex items-start gap-3 px-4 py-3">
          <Avatar name={contact.name} size="sm" className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-body-sm font-medium text-foreground">{contact.name}</span>
              {contact.primary ? <Badge tone="neutral">{primaryLabel}</Badge> : null}
            </div>
            {contact.role ? (
              <p className="text-caption text-muted-foreground">{contact.role}</p>
            ) : null}
            {contact.channels.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-caption">
                {contact.channels.map((channel) => (
                  <a
                    key={channel.key}
                    href={channel.href}
                    dir="ltr"
                    aria-label={channel['aria-label']}
                    target={channel.external ? '_blank' : undefined}
                    rel={channel.external ? 'noopener noreferrer' : undefined}
                    className="min-w-0 truncate text-brand-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
                  >
                    {channel.label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions(contact)}</div> : null}
        </li>
      ))}
    </ul>
  );
}
