'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Label,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { useCommercialSummary, useVariations } from '@/features/commercial/hooks/use-commercial';

import { useRebaseline } from '../hooks/use-progress';

/**
 * Re-baseline dialog (Master Schedule P3, ADR-029). A re-baseline supersedes the governing
 * baseline with the current working curve, and — unlike the initial approve — it MUST cite a
 * Variation (Q-4): the plan does not move without a change order to justify it.
 *
 * The Variation list is contract-scoped, so it resolves the project's main contract from the
 * commercial summary and lists that contract's variations. "No contract" and "no variations" are
 * both real, non-error states here — a re-baseline simply cannot proceed, and the dialog says so
 * plainly rather than offering a submit that would only 4xx.
 */
export function RebaselineDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('progress');
  const tVo = useTranslations('commercial.variations');
  const tCommon = useTranslations('common');
  const { toast } = useToast();

  const summary = useCommercialSummary(projectId);
  const contractId = summary.data?.mainContract?.id ?? null;
  const variationsQuery = useVariations(contractId);
  const rebaseline = useRebaseline(projectId);

  const [variationOrderId, setVariationOrderId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const variations = variationsQuery.data?.variations ?? [];
  const loading = summary.isPending || (Boolean(contractId) && variationsQuery.isPending);
  const noContract = !summary.isPending && contractId === null;
  const noVariations = Boolean(contractId) && !variationsQuery.isPending && variations.length === 0;
  // The picker (and therefore the submit) is only offered once we know there is a contract with at
  // least one variation to cite — never while still resolving, and never in the two dead-end states.
  const canPick = !loading && !noContract && !noVariations;
  const canSubmit = canPick && variationOrderId !== '' && !rebaseline.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    rebaseline.mutate(
      { variationOrderId, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: t('baseline.governing.rebaselined') });
          onOpenChange(false);
        },
        onError: (e) =>
          setError(e instanceof ApiError ? e.message : t('baseline.governing.rebaselineFailed')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby="rebaseline-desc">
        <form onSubmit={handleSubmit}>
          <DialogTitle>{t('baseline.governing.rebaselineTitle')}</DialogTitle>
          <DialogDescription id="rebaseline-desc">
            {t('baseline.governing.rebaselineSubtitle')}
          </DialogDescription>

          <div className="mt-5 space-y-5">
            {error ? <Alert variant="error" messages={[error]} /> : null}

            {loading ? (
              <Skeleton className="h-10 w-full" />
            ) : noContract ? (
              <Alert variant="info" messages={[t('baseline.governing.noContract')]} />
            ) : noVariations ? (
              <Alert variant="info" messages={[t('baseline.governing.noVariations')]} />
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="rebaseline-vo">{t('baseline.governing.variationLabel')}</Label>
                <Select
                  id="rebaseline-vo"
                  value={variationOrderId}
                  onChange={setVariationOrderId}
                  placeholder={t('baseline.governing.variationPlaceholder')}
                >
                  <option value="">{t('baseline.governing.variationPlaceholder')}</option>
                  {variations.map((vo) => (
                    <option key={vo.id} value={vo.id}>
                      {vo.reference} — {vo.title} ({tVo(`status.${vo.status}`)})
                    </option>
                  ))}
                </Select>
                <p className="text-caption text-muted-foreground">
                  {t('baseline.governing.variationHint')}
                </p>
              </div>
            )}

            {canPick ? (
              <div className="space-y-1.5">
                <Label htmlFor="rebaseline-note">{t('baseline.governing.noteLabel')}</Label>
                <Textarea
                  id="rebaseline-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  rows={3}
                />
                <p className="text-caption text-muted-foreground">
                  {t('baseline.governing.noteHint')}
                </p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            {canPick ? (
              <Button type="submit" disabled={!canSubmit}>
                {rebaseline.isPending ? tCommon('saving') : t('baseline.governing.rebaselineConfirm')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={rebaseline.isPending}
            >
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
