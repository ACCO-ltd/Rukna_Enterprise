/** Wizard draft — persisted in sessionStorage so a page refresh doesn't lose work. */

export type CertOutcome = 'CERTIFIED' | 'PARTIALLY_CERTIFIED' | 'REJECTED';

export interface WizardContext {
  status: CertOutcome | '';
  notes: string;
}

export interface CertRow {
  applicationItemId: string;
  certifiedQuantity: string;
  varianceReason: string;
}

export interface AdHocDeduction {
  /** Client-only stable key — never sent to the server. */
  key: string;
  deductionType: 'TAX' | 'CONTRA' | 'OTHER';
  basis: string;
  amount: string;
}

export interface WizardDraft {
  context: WizardContext;
  rows: CertRow[];
  adHocDeductions: AdHocDeduction[];
}

export function emptyContext(): WizardContext {
  return {
    status: '',
    notes: '',
  };
}

const draftKey = (ipaId: string) => `ipc-draft-${ipaId}`;

export function loadDraft(ipaId: string): WizardDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(ipaId));
    return raw ? (JSON.parse(raw) as WizardDraft) : null;
  } catch {
    return null;
  }
}

export function saveDraft(ipaId: string, draft: WizardDraft): void {
  try {
    sessionStorage.setItem(draftKey(ipaId), JSON.stringify(draft));
  } catch {
    // sessionStorage full or unavailable — silent fail
  }
}

export function clearDraft(ipaId: string): void {
  try {
    sessionStorage.removeItem(draftKey(ipaId));
  } catch {
    // ignore
  }
}
