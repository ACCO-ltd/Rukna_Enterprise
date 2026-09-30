import { Check } from 'lucide-react';

import { cn } from '../lib/utils';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

export interface SuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already-translated, past tense: "Contract ACC-HDN-26-0005-C1 executed". */
  title: string;
  /** What this unlocks, or what happens next. One or two sentences. */
  description?: string;
  /** The single close action — "Done". */
  doneLabel: string;
  /** Optional follow-up — "View invoice". Closes the dialog, then runs. */
  action?: { label: string; onClick: () => void };
  closeLabel?: string;
}

/**
 * The confirmation for a rare, consequential command — a contract executed, an invoice
 * posted, a period closed. Everyday saves use a toast instead: a modal on every save costs a
 * click dozens of times a day, and teaches people to dismiss it unread. This one earns its
 * interruption by marking a step the whole project moves past.
 */
export function SuccessDialog({
  open,
  onOpenChange,
  title,
  description,
  doneLabel,
  action,
  closeLabel,
}: SuccessDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" closeLabel={closeLabel} className="text-center">
        <div
          className={cn(
            'mx-auto mb-5 flex size-16 items-center justify-center rounded-full bg-success-subtle text-success',
            'motion-safe:animate-success-pop',
          )}
          aria-hidden="true"
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-success text-surface">
            <Check className="size-6" strokeWidth={3} />
          </span>
        </div>
        <DialogTitle className="text-h2">{title}</DialogTitle>
        {description ? (
          <DialogDescription className="mx-auto mt-2 max-w-sm text-body-sm text-muted-foreground">
            {description}
          </DialogDescription>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          {action ? (
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                action.onClick();
              }}
            >
              {action.label}
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)} autoFocus>
            {doneLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
