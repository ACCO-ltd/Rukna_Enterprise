import type { CreateClientPayload, UpdateClientPayload } from './api/clients-api';
import type { Client } from './types';

/** What the form holds — every field a string, as HTML inputs produce. */
export interface ClientFormValues {
  /** Legacy fixture compatibility; no form control or request payload uses this. */
  code?: string;
  name: string;
  /** Legacy fixture compatibility; Arabic business names are no longer captured. */
  type?: 'COMPANY' | 'GOVERNMENT' | 'NGO' | 'INDIVIDUAL' | 'OTHER';
  taxNumber: string;
  defaultCurrency: string;
  address?: string;
  notes?: string;
  contactName: string;
  contactRole: string;
  contactPhone: string;
  contactEmail: string;
}

export const EMPTY_CLIENT_FORM: ClientFormValues = {
  name: '',
  type: 'COMPANY',
  taxNumber: '',
  defaultCurrency: '',
  address: '',
  notes: '',
  contactName: '',
  contactRole: '',
  contactPhone: '',
  contactEmail: '',
};

/**
 * Converts form values into the `POST /clients` body.
 *
 * Empty optional fields are OMITTED rather than sent as `""`. `defaultCurrency` carries
 * `@Length(3, 3)`, so an empty string is not "absent" — it is an invalid three-character
 * code, and the request fails with a 400 the user cannot act on. The same reasoning as
 * projects: a blank tax number and an unknown tax number are different facts, and a
 * nullable column should hold NULL for the second.
 */
export function toCreateClientPayload(values: ClientFormValues): CreateClientPayload {
  const payload: CreateClientPayload = { name: values.name.trim() };

  const optional = { notes: values.notes ?? '' } as const;

  for (const [key, value] of Object.entries(optional)) {
    const trimmed = value.trim();
    if (trimmed) payload[key as keyof typeof optional] = trimmed;
  }
  payload.type = values.type ?? 'COMPANY';

  const contactName = values.contactName.trim();
  if (contactName) {
    payload.primaryContact = {
      name: contactName,
      role: values.contactRole.trim() || undefined,
      phone: values.contactPhone.trim() || undefined,
      email: values.contactEmail.trim() || undefined,
    };
  }

  return payload;
}

/**
 * Converts form values into a `PATCH /clients/:id` body.
 *
 * An emptied optional field is sent as `null`, not omitted — the same rule as
 * `toUpdateProjectPayload`, and for the same reason: on a PATCH, omitting means "leave
 * unchanged", so omission would make every optional field write-once. A user who typed a
 * tax number by mistake could never clear it again, which is not what "edit" means.
 *
 * `null` is safe to send even though `UpdateClientDto` declares `@IsString()`:
 * `@IsOptional()` short-circuits validation when the value is `null` or `undefined`
 * (class-validator's `IsOptional` constraint is `value !== null && value !== undefined`),
 * so the string check never runs. Prisma then writes NULL, where `undefined` would skip
 * the column. Every one of these columns is nullable.
 *
 * `status` is not part of this form — deactivating a client is a separate, deliberate
 * action, not something to change by accident while fixing a typo in a name.
 *
 * `code` is never sent: it is immutable after creation.
 */
export function toUpdateClientPayload(values: ClientFormValues): UpdateClientPayload {
  const text = (value: string): string | null => value.trim() || null;

  return {
    name: values.name.trim(),
    type: values.type ?? 'COMPANY',
    notes: text(values.notes ?? ''),
  };
}

/** Fills the form from an existing client, converting nulls to the empty strings inputs need. */
export function toClientFormValues(client: Client): ClientFormValues {
  return {
    name: client.name,
    type: client.type ?? 'COMPANY',
    taxNumber: client.taxNumber ?? '',
    defaultCurrency: client.defaultCurrency ?? '',
    address: client.address ?? '',
    notes: client.notes ?? '',
    contactName: '',
    contactRole: '',
    contactPhone: '',
    contactEmail: '',
  };
}
