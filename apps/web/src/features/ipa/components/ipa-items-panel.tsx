'use client';

import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useBoqTree } from '@/features/boq/hooks/use-boq';
import { formatMoney, formatNumber } from '@/lib/format';

import { claimableLines, isClaimable, lineLabel, unclaimedLines } from '../boq-leaves';
import { useAddIpaItem, useRemoveIpaItem } from '../hooks/use-ipa';
import type { IpaItem } from '../types';

interface IpaItemsPanelProps {
  ipaId: string;
  items: IpaItem[];
  projectId: string;
  boqVersionId: string;
  canEdit: boolean;
}

export function IpaItemsPanel({
  ipaId,
  items,
  projectId,
  boqVersionId,
  canEdit,
}: IpaItemsPanelProps) {
  const t = useTranslations('platform.ipa.items');
  const locale = useLocale() as 'en' | 'ar';
  const [isAdding, setIsAdding] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<IpaItem | null>(null);

  const remove = useRemoveIpaItem(ipaId);

  /**
   * The BOQ tree, read here rather than only inside the picker.
   *
   * `GET /ipa/:id` returns each item with a bare `boqNodeId` and nothing else — no code, no
   * description — so a claimed-lines table built from the response alone can only show an
   * opaque id. Resolving the labels means joining against the tree client-side; the query
   * is shared with the picker, so this costs one fetch for both. Raised as C15.
   */
  const tree = useBoqTree(projectId, boqVersionId);
  const linesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of claimableLines(tree.data ?? [])) map.set(line.id, lineLabel(line));
    return map;
  }, [tree.data]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
        {canEdit ? (
          <Button
            size="sm"
            onClick={() => {
              setIsAdding(true);
            }}
          >
            {t('add')}
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('none')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
        </div>
      ) : (
        <TableScroll aria-label={t('heading')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('line')}</TableHead>
                <TableHead numeric>{t('unitRate')}</TableHead>
                <TableHead numeric>{t('cumulativeClaimed')}</TableHead>
                <TableHead numeric>{t('previousCertified')}</TableHead>
                <TableHead numeric>{t('periodQuantity')}</TableHead>
                <TableHead numeric>{t('periodAmount')}</TableHead>
                {canEdit ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  {/* Falls back to the id only while the tree is loading or if the node
                      has since been removed from the version — never leaves the cell
                      blank, since a claimed line with no identity is unauditable. */}
                  <TableCell className="min-w-56">
                    {linesById.get(item.boqNodeId) ?? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {item.boqNodeId.slice(-8)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell numeric>
                    <bdi>{formatMoney(item.unitRateSnapshot, item.currencySnapshot, locale)}</bdi>
                  </TableCell>
                  <TableCell numeric>
                    <bdi>{formatNumber(item.cumulativeClaimed, locale)}</bdi>
                  </TableCell>
                  {/* Everything from here is DERIVED BY THE SERVER from what the last
                      effective certificate certified. It is displayed, never recomputed —
                      a second opinion on these numbers is a second source of truth. */}
                  <TableCell numeric className="text-muted-foreground">
                    <bdi>{formatNumber(item.previousEffectiveCertified, locale)}</bdi>
                  </TableCell>
                  <TableCell numeric>
                    <bdi>{formatNumber(item.periodQuantity, locale)}</bdi>
                  </TableCell>
                  <TableCell numeric className="font-medium">
                    <bdi>{formatMoney(item.periodAmount, item.currencySnapshot, locale)}</bdi>
                  </TableCell>
                  {canEdit ? (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPendingRemoval(item);
                        }}
                      >
                        {t('remove')}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      {isAdding ? (
        <ClaimLineDialog
          ipaId={ipaId}
          projectId={projectId}
          boqVersionId={boqVersionId}
          claimedNodeIds={items.map((i) => i.boqNodeId)}
          onClose={() => {
            setIsAdding(false);
          }}
        />
      ) : null}

      {pendingRemoval ? (
        <ConfirmActionDialog
          title={t('removeTitle')}
          description={t('removeBody')}
          confirmLabel={t('remove')}
          isPending={remove.isPending}
          errorMessage={remove.isError ? t('removeFailed') : undefined}
          onConfirm={() => {
            remove.mutate(pendingRemoval.id, {
              onSuccess: () => {
                setPendingRemoval(null);
              },
            });
          }}
          onDismiss={() => {
            remove.reset();
            setPendingRemoval(null);
          }}
        />
      ) : null}
    </section>
  );
}

interface ClaimFormValues {
  boqNodeId: string;
  cumulativeClaimed: string;
}

function ClaimLineDialog({
  ipaId,
  projectId,
  boqVersionId,
  claimedNodeIds,
  onClose,
}: {
  ipaId: string;
  projectId: string;
  boqVersionId: string;
  claimedNodeIds: string[];
  onClose: () => void;
}) {
  const t = useTranslations('platform.ipa.items');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const tree = useBoqTree(projectId, boqVersionId);
  const add = useAddIpaItem(ipaId);

  const available = useMemo(
    () => unclaimedLines(claimableLines(tree.data ?? []), claimedNodeIds),
    [tree.data, claimedNodeIds],
  );

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClaimFormValues>({
    defaultValues: { boqNodeId: '', cumulativeClaimed: '' },
  });

  const selectedId = useWatch({ control, name: 'boqNodeId' });
  const selected = available.find((line) => line.id === selectedId) ?? null;

  const onSubmit = (values: ClaimFormValues) => {
    if (!selected || !isClaimable(selected)) return;

    add.mutate(
      {
        boqNodeId: selected.id,
        // Taken verbatim from the BOQ node, never typed. The API accepts whatever is sent
        // here as the price this line is claimed at (C3, issue #10) — so the one safe
        // value to send is the contract BOQ's own rate.
        unitRateSnapshot: selected.unitRate!,
        currencySnapshot: selected.currency!,
        cumulativeClaimed: values.cumulativeClaimed.trim(),
      },
      { onSuccess: onClose },
    );
  };

  const hasNoLines = !tree.isPending && available.length === 0;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !add.isPending) onClose();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (add.isPending) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (add.isPending) e.preventDefault();
        }}
      >
        <DialogTitle>{t('add')}</DialogTitle>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 space-y-4"
          noValidate
        >
          {add.isError ? <Alert variant="error" messages={[t('failed')]} /> : null}
          {hasNoLines ? (
            <Alert
              variant="info"
              messages={[claimedNodeIds.length > 0 ? t('allClaimed') : t('noLines')]}
            />
          ) : null}

          <FormField htmlFor="claim-line" label={t('line')} error={errors.boqNodeId?.message}>
            <Select
              id="claim-line"
              disabled={tree.isPending || hasNoLines}
              aria-invalid={Boolean(errors.boqNodeId)}
              {...register('boqNodeId', { required: t('linePlaceholder') })}
            >
              <option value="">{tree.isPending ? tCommon('loading') : t('linePlaceholder')}</option>
              {available.map((line) => (
                // An unpriced leaf stays in the list, disabled. Dropping it silently from
                // a BOQ the surveyor is reading alongside would look like missing data.
                <option key={line.id} value={line.id} disabled={!isClaimable(line)}>
                  {lineLabel(line)}
                  {isClaimable(line) ? '' : ` — ${t('unpriced')}`}
                </option>
              ))}
            </Select>
          </FormField>

          {selected ? (
            <dl className="grid gap-3 rounded-control border border-border bg-surface-subtle p-3 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">{t('unitRate')}</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  <bdi>{formatMoney(selected.unitRate, selected.currency, locale) ?? '—'}</bdi>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('contractQuantity')}</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  <bdi>
                    {formatNumber(selected.quantity, locale) ?? '—'}
                    {selected.unit ? ` ${selected.unit}` : ''}
                  </bdi>
                </dd>
              </div>
              <div className="sm:col-span-3">
                <p className="text-muted-foreground">{t('serverDerived')}</p>
              </div>
            </dl>
          ) : null}

          <FormField
            htmlFor="claim-cumulative"
            label={t('cumulativeClaimed')}
            error={errors.cumulativeClaimed?.message}
          >
            <Input
              id="claim-cumulative"
              inputMode="decimal"
              aria-describedby="claim-cumulative-hint"
              aria-invalid={Boolean(errors.cumulativeClaimed)}
              {...register('cumulativeClaimed', {
                validate: (v) => {
                  if (v.trim() === '') return t('quantityRequired');
                  return Number.isFinite(Number(v)) || t('quantityInvalid');
                },
              })}
            />
            {/* The single most misread field on this screen: it is the total to date, not
                this period. The server subtracts what was previously certified to get the
                period figure. */}
            <p id="claim-cumulative-hint" className="text-xs text-muted-foreground">
              {t('cumulativeHint')}
            </p>
          </FormField>

          <DialogFooter>
            <Button type="submit" disabled={add.isPending || hasNoLines}>
              {add.isPending ? tCommon('loading') : t('save')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={add.isPending}>
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
