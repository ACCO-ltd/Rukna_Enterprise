import { ApiError } from '@/lib/api-client';

/** The server's code for "this report takes a BOQ item past its quantity". */
export const DPR_EXCEEDS_BOQ_QUANTITY = 'DPR_EXCEEDS_BOQ_QUANTITY';

/** One item the server refused: the most this report may still record for it. */
export interface DprQuantityFieldError {
  /** Already formatted-ready decimal string (the server's figure, never recomputed here). */
  max: string;
  unit: string | null;
}

export interface MappedDprError {
  /** Keyed by BOQ node id — rendered inline under that item's quantity input. */
  fieldErrors: Record<string, DprQuantityFieldError>;
  /**
   * The form-level summary, always set: for placed errors it names each item and its limit (so
   * the reader learns what to fix even when the item is scrolled out of view); otherwise it is the
   * server's own message.
   */
  formError: string;
}

/**
 * Maps a failed save/submit to where its message belongs.
 *
 * `DPR_EXCEEDS_BOQ_QUANTITY` carries `details.lines[{ boqNodeId, maxForThisReport, unit }]`: each
 * line becomes an inline error on that item. The code arrives with a backend change that may not
 * be deployed yet, so this is written defensively — a line missing a usable id or maximum is
 * skipped, and when nothing can be placed on an item (or the error is anything else) the server's
 * own message is shown as a form-level error instead.
 *
 * `describeExceeds` builds the summary for placed errors (the caller knows item names and units);
 * without it the server's message is the summary.
 */
export function mapDprError(
  error: unknown,
  fallback: string,
  describeExceeds?: (fieldErrors: Record<string, DprQuantityFieldError>) => string,
): MappedDprError {
  const fieldErrors: Record<string, DprQuantityFieldError> = {};

  if (error instanceof ApiError && error.code === DPR_EXCEEDS_BOQ_QUANTITY) {
    const lines = error.details?.['lines'];
    if (Array.isArray(lines)) {
      for (const raw of lines) {
        if (!raw || typeof raw !== 'object') continue;
        const line = raw as Record<string, unknown>;
        const id = line['boqNodeId'];
        const max = line['maxForThisReport'];
        if (typeof id !== 'string' || id === '') continue;
        if (typeof max !== 'string' && typeof max !== 'number') continue;
        if (typeof max === 'number' && !Number.isFinite(max)) continue;
        const unit = typeof line['unit'] === 'string' && line['unit'] !== '' ? (line['unit'] as string) : null;
        fieldErrors[id] = { max: String(max), unit };
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors, formError: describeExceeds ? describeExceeds(fieldErrors) : errorMessage(error, fallback) };
    }
  }

  return { fieldErrors, formError: errorMessage(error, fallback) };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.messages.length > 0) return error.messages[0]!;
    if (error.message) return error.message;
  }
  return fallback;
}
