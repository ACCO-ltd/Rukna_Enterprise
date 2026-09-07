import { BadRequestException } from '@nestjs/common';

/**
 * The document's identity, and the rule that makes it unique.
 *
 * A controlled document is identified by its number — "ACCO-OB-STR-DRG-0012" — not by its
 * filename. `final-drawing-v2.pdf` is what someone called the bytes on their laptop; it is not a
 * reference anyone can quote to the consultant, and it changes every time the file is replaced.
 *
 * Uniqueness is per project and case-insensitive, because "acco-ob-0012" and "ACCO-OB-0012" are
 * the same document to every human who reads them and two rows to Postgres. The normalised form
 * is stored in its own column so the unique index is a plain b-tree on a real value rather than a
 * functional index the ORM cannot see.
 *
 * Punctuation is deliberately NOT stripped. `ACCO-OB-0012` and `ACCO/OB/0012` may well be two
 * different numbering schemes running in parallel on the same project, and collapsing them would
 * silently refuse a legitimate document.
 */

const MAX_LENGTH = 60;
/** Letters, digits, and the separators construction numbering actually uses. */
const ALLOWED = /^[A-Za-z0-9][A-Za-z0-9 ._\-/]*$/;

export function normaliseDocumentNumber(raw: string): string {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');

  if (!trimmed) {
    throw new BadRequestException('Enter a document number — it is how this document is identified.');
  }
  if (trimmed.length > MAX_LENGTH) {
    throw new BadRequestException(`A document number cannot be longer than ${MAX_LENGTH} characters.`);
  }
  if (!ALLOWED.test(trimmed)) {
    throw new BadRequestException(
      'A document number may contain letters, digits, spaces and the separators . _ - / only.',
    );
  }
  return trimmed;
}

/** The uniqueness key. Never displayed — the number the user typed is what reads back. */
export function documentNumberKey(raw: string): string {
  return normaliseDocumentNumber(raw).toUpperCase();
}

const MAX_TITLE = 200;

export function normaliseTitle(raw: string): string {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    throw new BadRequestException('Enter a document title.');
  }
  if (trimmed.length > MAX_TITLE) {
    throw new BadRequestException(`A document title cannot be longer than ${MAX_TITLE} characters.`);
  }
  return trimmed;
}

const MAX_REVISION_CODE = 20;

/**
 * The business-facing revision label — "R00", "Rev B", "C1". Optional on purpose: a one-off
 * insurance certificate has no revision code, and generating "R00" for it would put a drawing
 * office convention on an instrument that has never had one.
 */
export function normaliseRevisionCode(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  if (trimmed.length > MAX_REVISION_CODE) {
    throw new BadRequestException(
      `A revision code cannot be longer than ${MAX_REVISION_CODE} characters.`,
    );
  }
  return trimmed;
}
