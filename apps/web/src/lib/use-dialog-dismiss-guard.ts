// Promoted to @erp/ui (ADR-039) so FormDialog and hand-built dialogs share one dismissal rule.
// Kept as a re-export so existing imports keep working.
export { useDialogDismissGuard } from '@erp/ui';
export type { DialogDismissGuard, DialogDismissGuardOptions } from '@erp/ui';
