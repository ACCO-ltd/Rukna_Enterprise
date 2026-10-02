import { ApiError } from '@/lib/api-client';

import type { ClientErrorCode } from './types';

const KNOWN_CODES: readonly ClientErrorCode[] = [
  'PHONE_INVALID',
  'EMAIL_INVALID',
  'NAME_INVALID',
  'COUNTRY_INVALID',
  'PAYMENT_TERMS_INVALID',
  'FIELD_INVALID',
  'REASON_INVALID',
  'NO_CHANGES',
  'CONTACT_REQUIRED',
  'CONTACT_IS_PRIMARY',
  'CLIENT_HAS_ACTIVE_PROJECTS',
  'CLIENT_HAS_OPEN_BALANCE',
  'CLIENT_ALREADY_INACTIVE',
  'CLIENT_ALREADY_ACTIVE',
];

/** The client endpoints' error code, when the failure is one the screens explain in words. */
export function clientErrorCode(error: unknown): ClientErrorCode | null {
  if (!(error instanceof ApiError) || !error.code) return null;
  return (KNOWN_CODES as readonly string[]).includes(error.code)
    ? (error.code as ClientErrorCode)
    : null;
}

/**
 * The field a `PHONE_INVALID` / `EMAIL_INVALID` names (`primaryContact.phone`, `whatsappPhone`,
 * `invoiceEmail`…). The API's error envelope carries it in `details.field`; `null` when absent.
 */
export function clientErrorField(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const field = error.details?.['field'];
  return typeof field === 'string' ? field : null;
}

/**
 * Which of a form's phone fields a `PHONE_INVALID` belongs to. WhatsApp only when the server
 * named it; otherwise the main phone — the one every contact has.
 */
export function phoneFieldOf(error: unknown): 'phone' | 'whatsapp' {
  return /whatsapp/i.test(clientErrorField(error) ?? '') ? 'whatsapp' : 'phone';
}

/** Which email field an `EMAIL_INVALID` belongs to on the client form. */
export function emailFieldOf(error: unknown): 'invoiceEmail' | 'contactEmail' {
  return /invoice/i.test(clientErrorField(error) ?? '') ? 'invoiceEmail' : 'contactEmail';
}
