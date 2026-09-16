'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  Input,
  Label,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Textarea,
  ViewSwitcher,
  cn,
  useToast,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { useCreateVariation } from '../hooks/use-commercial';
import {
  draftLineAmount,
  draftNet,
  emptyDraftLine,
  isDraftLineComplete,
  toLinePayloads,
  type DraftLine,
} from '../variations-draft';

/**
 * Raise a VariationOrder in DRAFT.
 *
 * Defaults to a single **Amount** field (net effect + the addition/omission sign), because most
 * variations are a negotiated figure, not a quantity×rate breakdown — the full line-item editor
 * used to be the *only* entry point, which read as a BOQ-style form for what is often "+$2,000 for
 * X". "Itemize by quantity & rate" is the escape hatch for when a real breakdown is worth keeping.
 *
 * Both modes ultimately produce the same `VariationLinePayload[]` the server already accepts
 * (CONST-VAR-003: the server derives `netPrice` from `lines`, never from a client-sent total) — the
 * Amount field is UI sugar that builds a single line under the hood, not a new payload shape.
 *
 * The addition/omission sign is a segmented toggle rather than a typed minus: an omission is a
 * distinct intent ("remove this scope"), and asking a user to express it by typing `-40` is how a
 * mistyped sign silently flips a credit into a charge.
 */
export function VariationCreateSheet({
  open,
  onOpenChange,
  ...formProps
}: {
  projectId: string;
  contractId: string;
  currency: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (variationId: string) => void;
}) {
  // The form body is mounted only while the sheet is open, so its state starts fresh every time
  // rather than being reset by an effect — a cancelled draft can never bleed into the next.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" aria-describedby="vo-create-desc">
        {open ? <CreateForm {...formProps} onOpenChange={onOpenChange} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({
  projectId,
  contractId,
  currency,
  onOpenChange,
  onCreated,
}: {
  projectId: string;
  contractId: string;
  currency: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (variationId: string) => void;
}) {
  const t = useTranslations('commercial.variations');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { toast } = useToast();
  const create = useCreateVariation(contractId, projectId);

  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [timeImpact, setTimeImpact] = React.useState('');
  const [mode, setMode] = React.useState<'AMOUNT' | 'ITEMIZE'>('AMOUNT');
  const [amountKind, setAmountKind] = React.useState<DraftLine['kind']>('ADDITION');
  const [amountValue, setAmountValue] = React.useState('');
  const [lines, setLines] = React.useState<DraftLine[]>([emptyDraftLine(cryptoId())]);

  // Whichever mode is active, this is the one set of lines that actually gets saved — Amount mode
  // folds its single figure into the same shape the itemize editor already produces.
  const effectiveLines: DraftLine[] =
    mode === 'AMOUNT'
      ? amountValue.trim() === ''
        ? []
        : [
            {
              id: 'amount',
              description: title.trim(),
              quantity: '1',
              unitRate: amountValue,
              kind: amountKind,
            },
          ]
      : lines;

  const net = draftNet(effectiveLines);
  const canSave = title.trim() !== '' && !create.isPending;

  function updateLine(id: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  // Seed the itemize editor from the amount just entered, but only while it still holds the
  // pristine default line — switching modes back and forth must never clobber real itemize work.
  function switchToItemize() {
    setLines((prev) => {
      const pristine =
        prev.length === 1 &&
        prev[0]!.description === '' &&
        prev[0]!.quantity === '' &&
        prev[0]!.unitRate === '';
      if (pristine && amountValue.trim() !== '') {
        return [{ ...prev[0]!, quantity: '1', unitRate: amountValue, kind: amountKind }];
      }
      return prev;
    });
    setMode('ITEMIZE');
  }

  // Folds every itemized line into one net figure — lossless in value (the server-facing net
  // effect is identical either way), lossy only in the per-line breakdown, which is exactly what
  // Amount mode is for. Flagged with a toast when there was more than one line to fold.
  function switchToAmount() {
    const complete = lines.filter(isDraftLineComplete);
    if (complete.length > 0) {
      const total = draftNet(complete);
      setAmountValue(String(Math.abs(total)));
      setAmountKind(total < 0 ? 'OMISSION' : 'ADDITION');
      if (complete.length > 1) {
        toast({ title: t('create.itemizeCollapsedToast'), tone: 'info' });
      }
    }
    setMode('AMOUNT');
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;

    const parsedTime = timeImpact.trim() === '' ? undefined : Number(timeImpact);
    create.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        proposedTimeImpactDays:
          parsedTime !== undefined && Number.isFinite(parsedTime) ? parsedTime : undefined,
        lines: toLinePayloads(effectiveLines),
      },
      {
        onSuccess: (variation) => {
          toast({ title: t('toast.created', { ref: variation.reference }), tone: 'success' });
          onOpenChange(false);
          onCreated(variation.id);
        },
        onError: (error) => {
          toast({ title: errorMessage(error, t('toast.createFailed')), tone: 'error' });
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-5 py-4">
        <DialogTitle>{t('create.title')}</DialogTitle>
        <DialogDescription id="vo-create-desc">{t('create.subtitle')}</DialogDescription>
        <LifecyclePreviewRail />
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="vo-title">{t('create.fieldTitle')}</Label>
          <Input
            id="vo-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
            placeholder={t('create.titlePlaceholder')}
            required
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="vo-desc">{t('create.fieldDescription')}</Label>
          <Textarea
            id="vo-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder={t('create.descriptionPlaceholder')}
          />
        </div>

        <div className="space-y-2.5">
          <ViewSwitcher
            aria-label={t('create.modeLabel')}
            value={mode}
            onValueChange={(value) => (value === 'ITEMIZE' ? switchToItemize() : switchToAmount())}
            items={[
              { value: 'AMOUNT', label: t('create.modeAmount') },
              { value: 'ITEMIZE', label: t('create.modeItemize') },
            ]}
          />

          {mode === 'AMOUNT' ? (
            <div className="space-y-1.5 rounded-control border border-border bg-surface-subtle p-3">
              <div className="flex items-center gap-2">
                <ViewSwitcher
                  aria-label={t('create.lineKind')}
                  value={amountKind}
                  onValueChange={(value) => setAmountKind(value as DraftLine['kind'])}
                  items={[
                    { value: 'ADDITION', label: t('create.addition') },
                    { value: 'OMISSION', label: t('create.omission') },
                  ]}
                />
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="vo-amount" className="sr-only">
                    {t('create.amountLabel')}
                  </Label>
                  <Input
                    id="vo-amount"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={amountValue}
                    onChange={(e) => setAmountValue(e.target.value)}
                    placeholder={t('create.amountPlaceholder')}
                    className="tabular-nums"
                  />
                </div>
              </div>
              <p className="text-caption text-muted-foreground">{t('create.amountHint')}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-body-sm font-semibold text-foreground">
                  {t('create.linesTitle')}
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLines((prev) => [...prev, emptyDraftLine(cryptoId())])}
                >
                  <Plus size={14} aria-hidden="true" />
                  {t('create.addLine')}
                </Button>
              </div>

              {lines.map((line, index) => {
                const amount = draftLineAmount(line);
                return (
                  <div
                    key={line.id}
                    className="space-y-2 rounded-control border border-border bg-surface-subtle p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <ViewSwitcher
                        aria-label={t('create.lineKind')}
                        value={line.kind}
                        onValueChange={(value) =>
                          updateLine(line.id, { kind: value as DraftLine['kind'] })
                        }
                        items={[
                          { value: 'ADDITION', label: t('create.addition') },
                          { value: 'OMISSION', label: t('create.omission') },
                        ]}
                      />
                      {lines.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('create.removeLine')}
                          onClick={() =>
                            setLines((prev) => prev.filter((l) => l.id !== line.id))
                          }
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={`vo-line-desc-${line.id}`} className="text-caption">
                        {t('create.lineDescription')}
                      </Label>
                      <Input
                        id={`vo-line-desc-${line.id}`}
                        value={line.description}
                        onChange={(e) => updateLine(line.id, { description: e.target.value })}
                        maxLength={500}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`vo-line-qty-${line.id}`} className="text-caption">
                          {t('create.quantity')}
                        </Label>
                        <Input
                          id={`vo-line-qty-${line.id}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                          className="tabular-nums"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`vo-line-rate-${line.id}`} className="text-caption">
                          {t('create.unitRate')}
                        </Label>
                        <Input
                          id={`vo-line-rate-${line.id}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={line.unitRate}
                          onChange={(e) => updateLine(line.id, { unitRate: e.target.value })}
                          className="tabular-nums"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-border/70 pt-2 text-caption">
                      <span className="text-muted-foreground">
                        {t('create.lineLabel', { n: index + 1 })}
                      </span>
                      <span className="font-medium tabular-nums text-foreground">
                        {amount === null ? '—' : formatMoney(amount, currency, locale)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between rounded-control bg-muted px-3 py-2.5">
            <span className="text-body-sm font-medium text-foreground">
              {t('create.netPreview')}
            </span>
            <span className="text-body-sm font-semibold tabular-nums text-foreground">
              {formatMoney(net, currency, locale)}
            </span>
          </div>
          <p className="text-caption text-muted-foreground">{t('create.netPreviewHint')}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="vo-time">{t('create.fieldTimeImpact')}</Label>
          <Input
            id="vo-time"
            type="number"
            inputMode="numeric"
            value={timeImpact}
            onChange={(e) => setTimeImpact(e.target.value)}
            className="w-32"
          />
          <p className="text-caption text-muted-foreground">{t('create.timeImpactHint')}</p>
        </div>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={!canSave}>
          {create.isPending ? tCommon('saving') : t('create.save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={create.isPending}
        >
          {tCommon('cancel')}
        </Button>
      </DialogFooter>
    </form>
  );
}

const LIFECYCLE_PREVIEW_STAGES = ['DRAFT', 'SUBMIT', 'INTERNAL', 'CLIENT', 'BILLING'] as const;

/**
 * A quiet, non-interactive preview of where a saved draft goes next — Draft is the only reachable
 * step from this dialog, so it is the only one highlighted. Deliberately not the `Wizard` shell
 * from `@erp/ui`: that component gates progress through a single flow's own steps, but this rail
 * describes the *entity's* lifecycle across screens the user hasn't opened yet, purely for
 * orientation. Same visual grammar as the Contract tab's status rail.
 */
function LifecyclePreviewRail() {
  const t = useTranslations('commercial.variations.create');
  return (
    <ol
      className="mt-2.5 flex items-center gap-1.5 overflow-x-auto"
      aria-label={t('lifecyclePreview')}
    >
      {LIFECYCLE_PREVIEW_STAGES.map((stage, index) => (
        <li key={stage} className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              'whitespace-nowrap text-micro font-medium',
              index === 0 ? 'text-brand-primary' : 'text-muted-foreground',
            )}
          >
            {t(`lifecycleStage.${stage}`)}
          </span>
          {index < LIFECYCLE_PREVIEW_STAGES.length - 1 ? (
            <span aria-hidden="true" className="h-px w-4 shrink-0 bg-border-strong" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `line-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}
