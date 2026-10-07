import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { ActionAvailability } from './quotation-state.policy.js';

/**
 * ADR-044 §12 — refusals carry a machine code. The code is in `error.details.code` (the place the
 * SoD 403 already uses, forwarded by GlobalExceptionFilter) and, except for 403s, also in
 * `error.code`. Messages are the user-facing explanation.
 */

const MESSAGES: Record<string, string> = {
  MISSING_PERMISSION: 'You do not have permission for this quotation action.',
  QUOTATION_CANCELLED: 'This quotation request has been cancelled.',
  QUOTATION_FROZEN:
    'The quotes were sent to finance and are frozen. Reopen the request to add or replace a photo.',
  QUOTATION_NOT_COLLECTING: 'The request is not collecting quotes, so it cannot be sent.',
  QUOTATION_NOT_AWAITING_DECISION: 'The request is not waiting for a finance decision.',
  QUOTATION_NOT_PENDING_APPROVAL: 'There is no award awaiting approval on this request.',
  QUOTATION_NOT_AWARDED: 'The request has not been awarded.',
  QUOTES_REQUIRED: 'Add at least one quote before sending to finance.',
  QUOTE_TOTALS_MISSING: 'Enter the total of every quote before choosing one.',
  PURCHASE_ORDER_LIVE:
    'A draft purchase order was already raised from this award. Cancel that draft first.',
  PURCHASE_ORDER_CONFIRMED: 'A purchase order raised from this award has been issued; the award is spent.',
  MATERIAL_REQUEST_NOT_APPROVED: 'Quotes can only be collected for an approved material request.',
  MATERIAL_REQUEST_ALREADY_ORDERED:
    'This material request is already on a purchase order, so quotes cannot be collected for it.',
  QUOTE_PHOTO_DUPLICATE: 'This photo is already attached to another quote on this request.',
  QUOTE_COUNT_EXCEPTION_REQUIRED:
    'Fewer stores than required: the collector must give a reason when sending, and finance must accept it when choosing.',
  QUOTE_NOT_ACTIVE: 'That quote is not active on this request.',
  NON_LOWEST_REASON_REQUIRED: 'This is not the lowest quote — choose a reason.',
  NON_LOWEST_NOTE_REQUIRED: 'Explain the reason for choosing a quote that is not the lowest.',
  AWARD_PENDING_DIFFERENT_CHOICE:
    'Another quote is already awaiting approval on this request. Withdraw that award first.',
  AWARD_PENDING_APPROVAL: 'The award needs workflow approval before it takes effect.',
  SUPPLIER_INACTIVE: 'The supplier is inactive and cannot be chosen.',
  SUPPLIER_REGISTRATION_REQUIRES_PAYABLES:
    'This store is not a registered supplier. A Finance Officer must register it first (Suppliers), then choose it here as the supplier.',
  FILE_NOT_ATTACHABLE: 'That photo cannot be attached.',
  PO_EXCEEDS_AWARD: 'The order would exceed the awarded total.',
  ORDER_LINES_REQUIRED: 'This award cannot be split automatically — enter the line amounts.',
  ORDER_LINE_NOT_ON_REQUEST: 'An order line is not a line of this material request.',
  ORDER_LINE_DUPLICATED: 'An order line appears twice.',
  ORDER_LINE_QUANTITY_INVALID: 'An order line quantity is zero or above what remains on the request.',
  ORDER_LINE_AMOUNT_INVALID: 'An order line amount must be positive with at most 2 decimals.',
  AWARD_CHANGED: 'The award behind this purchase order changed — reload and try again.',
  QUOTATION_CHANGED: 'The quotation request changed since you opened it — reload and try again.',
  CLIENT_REF_CONFLICT:
    'A different upload was already recorded under this upload key. Start a new quote instead of retrying with other photos.',
};

export function quotationMessage(code: string): string {
  return MESSAGES[code] ?? `Segregation-of-duties rule '${code}' prohibits this action.`;
}

export function quotationConflict(code: string, message = quotationMessage(code), extra: Record<string, unknown> = {}) {
  return new ConflictException({ errorCode: code, message, details: { code, ...extra } });
}

export function quotationForbidden(code: string, message = quotationMessage(code)) {
  return new ForbiddenException({ errorCode: 'FORBIDDEN', message, details: { code } });
}

export function quotationUnprocessable(code: string, message = quotationMessage(code)) {
  return new UnprocessableEntityException({ errorCode: code, message, details: { code } });
}

export function quotationBadRequest(code: string, message: string) {
  return new BadRequestException({ errorCode: 'VALIDATION_ERROR', message, details: { code } });
}

/** A blocked availability as the HTTP error a command answers with. */
export function availabilityError(availability: ActionAvailability): HttpException {
  const code = availability.reasonCode ?? 'QUOTATION_CHANGED';
  if (availability.blockKind === 'PERMISSION' || availability.blockKind === 'SOD') {
    return quotationForbidden(code);
  }
  return quotationConflict(code);
}
