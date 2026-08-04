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
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useContracts } from '@/features/contracts/hooks/use-contracts';
import { useIpas } from '@/features/ipa/hooks/use-ipa';
import { useIpcs } from '@/features/ipc/hooks/use-ipc';
import { formatDate, formatMoney } from '@/lib/format';

import {
  allocationProblem,
  certificatesForClient,
  fromMinorUnits,
  isFullyAllocated,
  toMinorUnits,
  unallocatedMinor,
} from '../allocation';
import { useAllocateReceipt, useRemoveAllocation } from '../hooks/use-receipts';
import type { ReceiptDetail, ReceiptAllocation } from '../types';

export function ReceiptAllocationsPanel({ receipt }: { receipt: ReceiptDetail }) {
  const t = useTranslations('platform.receipts.allocations');
  const locale = useLocale() as 'en' | 'ar';
  const [isAllocating, setIsAllocating] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<ReceiptAllocation | null>(null);

  const remove = useRemoveAllocation(receipt.id);
  const fullyAllocated = isFullyAllocated(receipt.amount, receipt.allocations);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
        {!fullyAllocated ? (
          <Button
            size="sm"
            onClick={() => {
              setIsAllocating(true);
            }}
          >
            {t('add')}
          </Button>
        ) : null}
      </div>

      {/* The API's own settlement status is unusable — it measures allocations against the
          GROSS certified total, so a fully paid certificate never reads as paid (C7). Said
          out loud rather than quietly omitted, because its absence is conspicuous on a
          payments screen. */}
      <Alert variant="info" messages={[t('statusCaveat')]} />

      {receipt.allocations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('none')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {receipt.allocations.map((allocation) => (
            <li
              key={allocation.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-muted-foreground">
                  {allocation.certificateId.slice(-8)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(allocation.allocatedAt, locale)}
                </p>
              </div>
              <p className="text-sm font-semibold text-foreground">
                <bdi>{formatMoney(allocation.allocatedAmount, receipt.currency, locale)}</bdi>
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPendingRemoval(allocation);
                }}
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {isAllocating ? (
        <AllocateDialog
          receipt={receipt}
          onClose={() => {
            setIsAllocating(false);
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

interface AllocateFormValues {
  certificateId: string;
  amount: string;
}

function AllocateDialog({ receipt, onClose }: { receipt: ReceiptDetail; onClose: () => void }) {
  const t = useTranslations('platform.receipts.allocations');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const allocate = useAllocateReceipt(receipt.id);

  // The three-hop join. No endpoint answers "certificates for this client", so all three
  // lists are fetched and joined here — see C16 and `certificatesForClient`.
  const certificates = useIpcs();
  const applications = useIpas();
  const contracts = useContracts();

  const isLoading = certificates.isPending || applications.isPending || contracts.isPending;

  const options = useMemo(
    () =>
      certificatesForClient(
        certificates.data ?? [],
        applications.data ?? [],
        contracts.data ?? [],
        receipt.clientId,
        receipt.allocations,
      ),
    [certificates.data, applications.data, contracts.data, receipt.clientId, receipt.allocations],
  );

  const remainingMinor = unallocatedMinor(receipt.amount, receipt.allocations);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AllocateFormValues>({
    defaultValues: { certificateId: '', amount: '' },
  });

  const selectedId = useWatch({ control, name: 'certificateId' });
  const selected = options.find((o) => o.certificate.id === selectedId) ?? null;

  // The API checks the certificate's ORGANIZATION but not its currency, so a USD receipt
  // can be allocated against a SOS certificate without complaint. Flagged rather than
  // blocked: a genuinely multi-currency settlement is the user's call, not ours.
  const currencyMismatch = selected !== null && selected.certificate.currency !== receipt.currency;

  const onSubmit = (values: AllocateFormValues) => {
    allocate.mutate(
      { certificateId: values.certificateId, allocatedAmount: values.amount.trim() },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !allocate.isPending) onClose();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (allocate.isPending) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (allocate.isPending) e.preventDefault();
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
          {allocate.isError ? <Alert variant="error" messages={[t('failed')]} /> : null}
          {!isLoading && options.length === 0 ? (
            <Alert variant="info" messages={[t('noCertificates')]} />
          ) : null}

          <FormField
            htmlFor="allocation-certificate"
            label={t('certificate')}
            error={errors.certificateId?.message}
          >
            <Select
              id="allocation-certificate"
              disabled={isLoading || options.length === 0}
              aria-invalid={Boolean(errors.certificateId)}
              {...register('certificateId', { required: t('certificateRequired') })}
            >
              <option value="">
                {isLoading ? tCommon('loading') : t('certificatePlaceholder')}
              </option>
              {options.map(({ certificate, contract, allocatedFromThisReceipt }) => (
                <option key={certificate.id} value={certificate.id}>
                  {contract.contractNumber} —{' '}
                  {certificate.certificateRef ?? certificate.id.slice(-8)}
                  {allocatedFromThisReceipt > 0
                    ? ` (${t('alreadyOnCertificate', {
                        amount: fromMinorUnits(allocatedFromThisReceipt),
                      })})`
                    : ''}
                </option>
              ))}
            </Select>
          </FormField>

          {currencyMismatch ? (
            <Alert
              variant="warning"
              messages={[
                t('currencyMismatch', {
                  certificateCurrency: selected.certificate.currency,
                  receiptCurrency: receipt.currency,
                }),
              ]}
            />
          ) : null}

          <FormField htmlFor="allocation-amount" label={t('amount')} error={errors.amount?.message}>
            <Input
              id="allocation-amount"
              inputMode="decimal"
              aria-describedby="allocation-remaining"
              aria-invalid={Boolean(errors.amount)}
              {...register('amount', {
                // Mirrors the server's guard and adds the lower bound it lacks, so an
                // over-allocation or a negative never costs a round-trip.
                validate: (v) => {
                  const problem = allocationProblem(v, receipt.amount, receipt.allocations);
                  return problem === null || t(problem);
                },
              })}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p id="allocation-remaining" className="text-xs text-muted-foreground">
                <bdi>
                  {t('remaining', {
                    amount:
                      formatMoney(fromMinorUnits(remainingMinor), receipt.currency, locale) ?? '',
                  })}
                </bdi>
              </p>
              {/* Settling a certificate in full is the common case; typing the balance by
                  hand is where a transposed digit gets in. */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setValue('amount', fromMinorUnits(remainingMinor), { shouldValidate: true });
                }}
              >
                {t('allocateAll')}
              </Button>
            </div>
          </FormField>

          <DialogFooter>
            <Button type="submit" disabled={allocate.isPending || options.length === 0}>
              {allocate.isPending ? tCommon('loading') : t('save')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={allocate.isPending}>
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Exported for the detail header, which shows the same figures above the panel. */
export function receiptTotals(receipt: ReceiptDetail) {
  const total = toMinorUnits(receipt.amount);
  const remaining = unallocatedMinor(receipt.amount, receipt.allocations);
  return { total, allocated: total - remaining, remaining };
}
