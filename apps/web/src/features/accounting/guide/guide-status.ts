import type { StatusTone } from '@erp/ui';
import type { GuideStepStatus } from '@erp/types';

/**
 * The single, truthful mapping of a guide step's state to a status tone (ADR-034) — used by the
 * hub checklist, the cycle-status strip and the inline hints alike, so the seven states never
 * pick up a different colour on a different surface.
 *
 *  DONE       success   — satisfied.
 *  NEXT       progress  — the immediate next action; the row is emphasised, not coloured danger.
 *  TODO       neutral   — a later step, not yet actionable.
 *  BLOCKED    attention — cannot proceed until a named blocker clears.
 *  ATTENTION  attention — items are waiting on the user (a queue, a failing gate).
 *  RESTRICTED neutral   — the user lacks the permission; the detail names who does it.
 *  NA         neutral   — not applicable right now.
 *
 * `brand-primary` is deliberately absent from status tones — it means "interactive". NEXT reads
 * as progress and earns its emphasis from weight and a border in the hub, not from a status hue.
 */
export const GUIDE_STEP_TONE: Record<GuideStepStatus, StatusTone> = {
  DONE: 'success',
  NEXT: 'progress',
  TODO: 'neutral',
  BLOCKED: 'attention',
  ATTENTION: 'attention',
  RESTRICTED: 'neutral',
  NA: 'neutral',
};

/** A step is finished-or-irrelevant: the inline hint renders nothing for these. */
export function isStepQuiet(status: GuideStepStatus): boolean {
  return status === 'DONE' || status === 'NA';
}
