import type { VariationLinePayload } from './api/commercial-api';

/**
 * Pure draft-composition logic for raising a VariationOrder, kept out of the component so the
 * running-net preview and the addition/omission sign rule are unit-testable.
 *
 * The FRONTEND never owns the authoritative net price — that is `VariationOrderResponse.netPrice`,
 * derived by the server (CONST-VAR-003). This preview exists only so a user composing a draft can
 * see the shape of what they are about to submit; the moment the draft is saved, the screen shows
 * the server's figure, not this one.
 */

/** A line as the form holds it: positive magnitudes, with the sign carried by `kind`. */
export interface DraftLine {
  id: string;
  description: string;
  /** Positive magnitude as a canonical numeric string (e.g. "12.5"); "" while empty. */
  quantity: string;
  /** Positive magnitude as a canonical numeric string; "" while empty. */
  unitRate: string;
  /** An addition adds scope (+); an omission removes it (signed negative on submit). */
  kind: 'ADDITION' | 'OMISSION';
}

export function emptyDraftLine(id: string): DraftLine {
  return { id, description: '', quantity: '', unitRate: '', kind: 'ADDITION' };
}

/** The signed amount of one line, or null when it is not yet a complete numeric line. */
export function draftLineAmount(line: DraftLine): number | null {
  if (line.quantity === '' || line.unitRate === '') return null;
  const qty = Number(line.quantity);
  const rate = Number(line.unitRate);
  if (!Number.isFinite(qty) || !Number.isFinite(rate)) return null;
  const magnitude = Math.abs(qty) * Math.abs(rate);
  return line.kind === 'OMISSION' ? -magnitude : magnitude;
}

/** Running net across the draft's complete lines — signed; negative for a net omission. */
export function draftNet(lines: DraftLine[]): number {
  return lines.reduce((sum, line) => sum + (draftLineAmount(line) ?? 0), 0);
}

/** A line is submittable only once it carries a description and both figures. */
export function isDraftLineComplete(line: DraftLine): boolean {
  return (
    line.description.trim() !== '' && line.quantity !== '' && line.unitRate !== '' &&
    draftLineAmount(line) !== null
  );
}

/**
 * The API payload for the complete lines only. Omission quantities are negated here (the one
 * place the sign is applied) so the rest of the form works in positive magnitudes.
 */
export function toLinePayloads(lines: DraftLine[]): VariationLinePayload[] {
  return lines.filter(isDraftLineComplete).map((line) => {
    const qty = Math.abs(Number(line.quantity));
    return {
      description: line.description.trim(),
      quantity: line.kind === 'OMISSION' ? -qty : qty,
      unitRate: Math.abs(Number(line.unitRate)),
    };
  });
}
