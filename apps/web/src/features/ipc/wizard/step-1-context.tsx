'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Label, Select, Textarea } from '@erp/ui';

import type { WizardContext } from './draft';

interface Step1Props {
  context: WizardContext;
  currency: string;
  onChange: (patch: Partial<WizardContext>) => void;
  onNext: () => void;
  errors: Partial<Record<keyof WizardContext, string>>;
}

export function Step1Context({ context, currency, onChange, onNext, errors }: Step1Props) {
  const t = useTranslations('platform.ipc.wizard.step1');
  const tWiz = useTranslations('platform.ipc.wizard');

  const statusId = useId();
  const notesId = useId();

  const isRejected = context.status === 'REJECTED';

  return (
    <div className="space-y-6">
      {/* Status select */}
      <FormField htmlFor={statusId} label={t('statusLabel')} error={errors.status}>
        <Select
          id={statusId}
          value={context.status}
          onChange={(e) => onChange({ status: e.target.value as WizardContext['status'] })}
        >
          <option value="" disabled>
            {t('statusPlaceholder')}
          </option>
          <option value="CERTIFIED">{t('status.CERTIFIED')}</option>
          <option value="PARTIALLY_CERTIFIED">{t('status.PARTIALLY_CERTIFIED')}</option>
          <option value="REJECTED">{t('status.REJECTED')}</option>
        </Select>
      </FormField>

      {/* Currency — read-only from contract */}
      <div className="space-y-1.5">
        <Label>{t('currencyLabel')}</Label>
        <p className="flex h-11 items-center rounded-md border border-border bg-muted px-3 text-sm text-foreground">
          {currency}
        </p>
        <p className="text-xs text-muted-foreground">{t('currencyNote')}</p>
      </div>

      {/* Notes / rejection reason */}
      <FormField
        htmlFor={notesId}
        label={isRejected ? t('rejectionReasonLabel') : t('notesLabel')}
      >
        <Textarea
          id={notesId}
          rows={3}
          value={context.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder={isRejected ? t('rejectionReasonPlaceholder') : undefined}
        />
      </FormField>

      {errors.status ? <Alert variant="error" messages={[errors.status]} /> : null}

      {/* Navigation */}
      <div className="flex justify-end">
        <Button type="button" onClick={onNext}>
          {isRejected ? tWiz('nav.nextReview') : tWiz('nav.nextItems')}
        </Button>
      </div>
    </div>
  );
}
