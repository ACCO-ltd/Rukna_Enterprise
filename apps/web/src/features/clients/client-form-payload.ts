import { normalizeEmail } from '@/lib/email-hints';
import { DEFAULT_PHONE_COUNTRY, EMPTY_PHONE, toE164, type PhoneValue } from '@/lib/phone';

import type { Client, ClientType, CreateClientPayload, UpdateClientPayload } from './types';

/** What the client form holds — strings as inputs produce them, phones as picker pairs. */
export interface ClientFormValues {
  name: string;
  type: ClientType;
  registrationNumber: string;
  taxNumber: string;
  // Primary contact — create only. On an existing client contacts are managed on the record.
  contactName: string;
  contactRole: string;
  contactPhone: PhoneValue;
  /** "Use this number for WhatsApp" — on by default. */
  whatsappSame: boolean;
  contactWhatsapp: PhoneValue;
  contactEmail: string;
  // Address
  countryCode: string;
  city: string;
  address: string;
  // Billing
  invoiceEmail: string;
  /** Digits as typed; converted to an integer on save. */
  paymentTermsDays: string;
  notes: string;
}

export const EMPTY_CLIENT_FORM: ClientFormValues = {
  name: '',
  type: 'COMPANY',
  registrationNumber: '',
  taxNumber: '',
  contactName: '',
  contactRole: '',
  contactPhone: { ...EMPTY_PHONE },
  whatsappSame: true,
  contactWhatsapp: { ...EMPTY_PHONE },
  contactEmail: '',
  countryCode: DEFAULT_PHONE_COUNTRY,
  city: '',
  address: '',
  invoiceEmail: '',
  paymentTermsDays: '',
  notes: '',
};

/** Trim and collapse inner whitespace — the server's rule for names. */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function paymentTerms(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const days = Number(trimmed);
  return Number.isInteger(days) ? days : null;
}

/**
 * Form values → `POST /clients` body. Empty optionals are omitted, not sent as `""`. Phones go
 * out as E.164; WhatsApp is the main phone unless a separate number was given. A job title is
 * not captured for an individual, so it is not sent for one even if typed before switching type.
 */
export function toCreateClientPayload(values: ClientFormValues): CreateClientPayload {
  const phone = toE164(values.contactPhone) ?? values.contactPhone.number.trim();
  const whatsapp = values.whatsappSame ? phone : toE164(values.contactWhatsapp);
  const role = values.type === 'INDIVIDUAL' ? '' : values.contactRole.trim();
  const email = normalizeEmail(values.contactEmail);

  const payload: CreateClientPayload = {
    name: normalizeName(values.name),
    type: values.type,
    countryCode: values.countryCode || DEFAULT_PHONE_COUNTRY,
    primaryContact: {
      // An individual client is their own contact.
      name: normalizeName(values.type === 'INDIVIDUAL' ? values.name : values.contactName),
      phone,
      ...(role ? { role } : {}),
      ...(whatsapp ? { whatsappPhone: whatsapp } : {}),
      ...(email ? { email } : {}),
    },
  };

  const optional = {
    registrationNumber: values.registrationNumber.trim(),
    taxNumber: values.taxNumber.trim(),
    city: values.city.trim(),
    address: values.address.trim(),
    invoiceEmail: normalizeEmail(values.invoiceEmail),
    notes: values.notes.trim(),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value) payload[key as keyof typeof optional] = value;
  }
  const terms = paymentTerms(values.paymentTermsDays);
  if (terms !== null) payload.paymentTermsDays = terms;

  return payload;
}

/**
 * Form values → `PATCH /clients/:id` body. An emptied optional field is sent as `null` — on a
 * PATCH omission means "leave unchanged", so omitting would make every optional field
 * write-once. No contacts (managed on the record) and no status (deactivate/reactivate).
 */
export function toUpdateClientPayload(values: ClientFormValues): UpdateClientPayload {
  const text = (value: string): string | null => value.trim() || null;
  return {
    name: normalizeName(values.name),
    type: values.type,
    registrationNumber: text(values.registrationNumber),
    taxNumber: text(values.taxNumber),
    countryCode: values.countryCode || DEFAULT_PHONE_COUNTRY,
    city: text(values.city),
    address: text(values.address),
    invoiceEmail: normalizeEmail(values.invoiceEmail) || null,
    paymentTermsDays: paymentTerms(values.paymentTermsDays),
    notes: text(values.notes),
  };
}

/** Fills the form from an existing client, converting nulls to the empty strings inputs need. */
export function toClientFormValues(client: Client): ClientFormValues {
  return {
    ...EMPTY_CLIENT_FORM,
    name: client.name,
    type: client.type ?? 'COMPANY',
    registrationNumber: client.registrationNumber ?? '',
    taxNumber: client.taxNumber ?? '',
    countryCode: client.countryCode ?? DEFAULT_PHONE_COUNTRY,
    city: client.city ?? '',
    address: client.address ?? '',
    invoiceEmail: client.invoiceEmail ?? '',
    paymentTermsDays:
      client.paymentTermsDays === null || client.paymentTermsDays === undefined
        ? ''
        : String(client.paymentTermsDays),
    notes: client.notes ?? '',
  };
}
