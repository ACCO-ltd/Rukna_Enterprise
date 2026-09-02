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
  useToast,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { useCreateVariation } from '../hooks/use-commercial';
import {
  draftLineAmount,
  draftNet,
  emptyDraftLine,
  toLinePayloads,
  type DraftLine,
} from '../variations-draft';

/**
 * Raise a VariationOrder in DRAFT. Collects a title and a set of line items — additions and
 * signed-negative omissions — and shows a running net PREVIEW while composing. The preview is the
 * client's own arithmetic for legibility only; the moment the draft saves, the workspace renders
 * the server's derived `netPrice` (CONST-VAR-003), never this figure.
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
  const [lines, setLines] = React.useState<DraftLine[]>([emptyDraftLine(cryptoId())]);

  const net = draftNet(lines);
  const canSave = title.trim() !== '' && !create.isPending;

  function updateLine(id: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
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
        lines: toLinePayloads(lines),
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
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="vo-title">{t('create.fieldTitle')}</Label>
              <Input
                id="vo-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={255}
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
              />
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
                        {amount === null
                          ? '—'
                          : formatMoney(amount, currency, locale)}
                      </span>
                    </div>
                  </div>
                );
              })}

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

function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `line-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}
