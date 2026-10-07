import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberWithError } from 'libphonenumber-js';

/**
 * ADR-044 phase 2 — a staff member's WhatsApp alert settings. Pure (only the 400s are Nest).
 *
 *   - The number is stored as canonical E.164 (`+252612345678`). It must be typed in international
 *     form (leading `+`); spaces, dashes and brackets are tolerated and dropped.
 *   - Alerts can only be ON with a number. Clearing the number turns alerts off.
 */

export interface StaffWhatsAppSettings {
  whatsappPhone: string | null;
  whatsappAlertsEnabled: boolean;
}

const invalid = (field: string, message: string) =>
  new BadRequestException({ errorCode: 'WHATSAPP_PHONE_INVALID', field, message, details: { field } });

/** A typed staff number → E.164, null for empty / null; a 400 when it is not a valid number. */
export function normaliseStaffWhatsAppPhone(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw invalid('whatsappPhone', 'Enter the number in international form, e.g. +252612345678');
  const text = value.trim();
  if (!text) return null;
  if (!text.startsWith('+') || text.length > 32 || /[^\d+\s\-().]/.test(text)) {
    throw invalid('whatsappPhone', 'Enter the number in international form, e.g. +252612345678');
  }
  try {
    const parsed = parsePhoneNumberWithError(text);
    if (!parsed.isValid()) throw new Error('invalid');
    return parsed.number;
  } catch {
    throw invalid('whatsappPhone', 'This is not a valid phone number. Use international form, e.g. +252612345678');
  }
}

/** The settings after an edit; fields left undefined keep their current value. */
export function nextStaffWhatsAppSettings(
  current: StaffWhatsAppSettings,
  input: { whatsappPhone?: string | null; whatsappAlertsEnabled?: boolean },
): StaffWhatsAppSettings {
  const whatsappPhone =
    input.whatsappPhone === undefined ? current.whatsappPhone : normaliseStaffWhatsAppPhone(input.whatsappPhone);
  let whatsappAlertsEnabled = input.whatsappAlertsEnabled ?? current.whatsappAlertsEnabled;
  if (!whatsappPhone) {
    if (input.whatsappAlertsEnabled === true) {
      throw invalid('whatsappAlertsEnabled', 'Add a WhatsApp number before turning on WhatsApp alerts.');
    }
    whatsappAlertsEnabled = false;
  }
  return { whatsappPhone, whatsappAlertsEnabled };
}

/** `…678` — the only form a staff number takes outside Administration → Users. */
export function maskStaffPhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length > 3 ? `…${digits.slice(-3)}` : '…';
}
