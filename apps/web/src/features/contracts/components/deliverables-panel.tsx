'use client';

import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { formatDate } from '@/lib/format';

import { useAddDeliverable, useCompleteDeliverable } from '../hooks/use-contract-terms';
import type { ContractDeliverable } from '../types';

interface DeliverablesPanelProps {
  contractId: string;
  deliverables: ContractDeliverable[];
  /** Today as `YYYY-MM-DD`, passed in rather than read from the clock during render. */
  today: string;
  canEdit: boolean;
}

export function DeliverablesPanel({
  contractId,
  deliverables,
  today,
  canEdit,
}: DeliverablesPanelProps) {
  const t = useTranslations('platform.contracts.terms.milestones');
  const locale = useLocale() as 'en' | 'ar';
  const [isAdding, setIsAdding] = useState(false);
  const [pendingCompletion, setPendingCompletion] = useState<ContractDeliverable | null>(null);

  const complete = useCompleteDeliverable(contractId);

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

      {deliverables.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('none')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {deliverables.map((deliverable) => {
            const isComplete = deliverable.completedAt !== null;
            const isOverdue =
              !isComplete &&
              deliverable.dueDate !== null &&
              deliverable.dueDate.slice(0, 10) < today;

            return (
              <li
                key={deliverable.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{deliverable.name}</span>
                    {isComplete ? <Badge tone="live">{t('completed')}</Badge> : null}
                    {isOverdue ? <Badge tone="warning">{t('overdue')}</Badge> : null}
                  </div>
                  {deliverable.description ? (
                    <p className="text-xs text-muted-foreground">{deliverable.description}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isComplete
                      ? t('completedOn', {
                          date: formatDate(deliverable.completedAt, locale) ?? '',
                        })
                      : (formatDate(deliverable.dueDate, locale) ?? t('noDueDate'))}
                  </p>
                </div>

                {/* There is no un-complete: `completeDeliverable` stamps completedAt and
                    completedBy and nothing reverses it. So the control disappears once
                    used, and the action is confirmed before it fires. */}
                {canEdit && !isComplete ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPendingCompletion(deliverable);
                    }}
                  >
                    {t('complete')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {isAdding ? (
        <AddDeliverableDialog
          contractId={contractId}
          nextSortOrder={deliverables.length + 1}
          onClose={() => {
            setIsAdding(false);
          }}
        />
      ) : null}

      {pendingCompletion ? (
        <ConfirmActionDialog
          title={t('completeTitle')}
          description={`${pendingCompletion.name} — ${t('completeBody')}`}
          confirmLabel={t('complete')}
          isPending={complete.isPending}
          errorMessage={complete.isError ? t('completeFailed') : undefined}
          onConfirm={() => {
            complete.mutate(pendingCompletion.id, {
              onSuccess: () => {
                setPendingCompletion(null);
              },
            });
          }}
          onDismiss={() => {
            complete.reset();
            setPendingCompletion(null);
          }}
        />
      ) : null}
    </section>
  );
}

interface DeliverableFormValues {
  name: string;
  description: string;
  dueDate: string;
}

function AddDeliverableDialog({
  contractId,
  nextSortOrder,
  onClose,
}: {
  contractId: string;
  nextSortOrder: number;
  onClose: () => void;
}) {
  const t = useTranslations('platform.contracts.terms.milestones');
  const tCommon = useTranslations('common');
  const add = useAddDeliverable(contractId);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<DeliverableFormValues>({
    defaultValues: { name: '', description: '', dueDate: '' },
  });

  const onSubmit = (values: DeliverableFormValues) => {
    add.mutate(
      {
        name: values.name.trim(),
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
        ...(values.dueDate ? { dueDate: values.dueDate } : {}),
        // The API defaults sortOrder to 0, so without this every deliverable would share a
        // position and the list order would be whatever Postgres returned.
        sortOrder: nextSortOrder,
      },
      { onSuccess: onClose },
    );
  };

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

          <FormField htmlFor="deliverable-name" label={t('name')} error={errors.name?.message}>
            <Input
              id="deliverable-name"
              aria-invalid={Boolean(errors.name)}
              {...register('name', {
                validate: (v) => v.trim() !== '' || t('nameRequired'),
              })}
            />
          </FormField>

          <FormField htmlFor="deliverable-description" label={t('description')}>
            <Input id="deliverable-description" {...register('description')} />
          </FormField>

          <FormField htmlFor="deliverable-due" label={t('dueDate')}>
            <Controller
              control={control}
              name="dueDate"
              render={({ field }) => (
                <DatePicker id="deliverable-due" value={field.value} onChange={field.onChange} />
              )}
            />
          </FormField>

          <DialogFooter>
            <Button type="submit" disabled={add.isPending}>
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
