'use client';

/**
 * The tax a client invoice is raised at (ADR-041), wherever one is raised.
 *
 * Everyone sees which code applies — "Tax: Sales tax 5% (5%)". Finance (`manage:accounting`) may
 * pick another ACTIVE sales code, the default preselected; anyone else raises at the default
 * (the server answers 403 TAX_CODE_OVERRIDE_FORBIDDEN otherwise). With no default configured the
 * invoice cannot be raised (409 TAX_NOT_CONFIGURED), so the field says so and the caller disables
 * its primary action on `choice.blocked`.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, FormField, Notice, Select } from '@erp/ui';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import { useTaxCodes } from '../hooks/use-accounting';
import {
  defaultTaxCodeOf,
  formatRatePercent,
  invoiceTaxErrorCode,
  invoiceTaxOptions,
  percentToFraction,
  type InvoiceTaxCode,
} from '../tax-codes';

export const TAX_SCREEN_HREF = '/finance/accounting/tax';

export interface InvoiceTaxChoice {
  /**
   * `loading` — the default is not known yet; `unknown` — the list could not be read, the server
   * will apply its default; `missing` — no default sales tax is configured; `ready` otherwise.
   */
  state: 'loading' | 'unknown' | 'missing' | 'ready';
  mayChoose: boolean;
  defaultCode: InvoiceTaxCode | null;
  selected: InvoiceTaxCode | null;
  /** ACTIVE sales codes Finance may choose from; empty for everyone else. */
  options: InvoiceTaxCode[];
  select: (id: string) => void;
  reset: () => void;
  /** Whether the person changed the code from the default. */
  changed: boolean;
  /** What to send: a code only when it differs from the default; omitted means the default. */
  taxCodeId: string | undefined;
  /** The chosen rate as a fraction ("0.050000") for a totals preview, or null when unknown. */
  rateFraction: string | null;
  /** True when the invoice cannot be raised: no default sales tax is set. */
  blocked: boolean;
}

export function useInvoiceTaxChoice({
  knownDefault,
  enabled = true,
}: {
  /**
   * The default code when the caller already has it (the commercial prepare preview carries it);
   * `undefined` reads it from `GET /tax-codes`.
   */
  knownDefault?: InvoiceTaxCode | null;
  enabled?: boolean;
}): InvoiceTaxChoice {
  const { can } = usePermissions();
  const mayChoose = can(ACCOUNTING_PERMISSIONS.manageChart);
  const needList = enabled && (mayChoose || knownDefault === undefined);
  const list = useTaxCodes({ enabled: needList });
  const [chosenId, setChosenId] = useState('');

  const listDefault = defaultTaxCodeOf(list.data);
  const defaultCode = knownDefault !== undefined ? knownDefault : listDefault;
  const options = mayChoose && list.data ? invoiceTaxOptions(list.data.codes) : [];

  const state: InvoiceTaxChoice['state'] =
    knownDefault === undefined && list.isPending
      ? 'loading'
      : knownDefault === undefined && list.isError
        ? 'unknown'
        : defaultCode === null
          ? 'missing'
          : 'ready';

  const chosen = chosenId ? (options.find((option) => option.id === chosenId) ?? null) : null;
  const selected = state === 'ready' ? (chosen ?? defaultCode) : null;
  const changed = Boolean(selected && defaultCode && selected.id !== defaultCode.id);

  return {
    state,
    mayChoose,
    defaultCode,
    selected,
    options,
    select: setChosenId,
    reset: () => setChosenId(''),
    changed,
    taxCodeId: changed && selected ? selected.id : undefined,
    rateFraction: selected ? percentToFraction(selected.ratePercent) : null,
    blocked: state === 'missing',
  };
}

/** `taxCodeId` as a body fragment: present only when it differs from the default. */
export function taxCodeBody(choice: InvoiceTaxChoice): { taxCodeId?: string } {
  return choice.taxCodeId ? { taxCodeId: choice.taxCodeId } : {};
}

/** The readable message for an ADR-041 refusal, or null for any other error. */
export function useInvoiceTaxErrorMessage(): (error: unknown) => string | null {
  const t = useTranslations('accounting.invoiceTax.error');
  return (error) => {
    const code = invoiceTaxErrorCode(error);
    return code ? t(code) : null;
  };
}

export function InvoiceTaxField({
  choice,
  id,
  disabled,
}: {
  choice: InvoiceTaxChoice;
  id: string;
  disabled?: boolean;
}) {
  const t = useTranslations('accounting.invoiceTax');

  if (choice.state === 'loading') {
    return <p className="text-body-sm text-muted-foreground">{t('loading')}</p>;
  }

  if (choice.state === 'unknown') {
    return <p className="text-body-sm text-muted-foreground">{t('loadFailed')}</p>;
  }

  if (choice.state === 'missing' || !choice.selected) {
    return (
      <Notice
        tone="attention"
        action={
          choice.mayChoose ? (
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href={TAX_SCREEN_HREF}>{t('missingLink')}</Link>
            </Button>
          ) : undefined
        }
      >
        {t('missing')}
      </Notice>
    );
  }

  const label = (code: InvoiceTaxCode) =>
    t('option', { name: code.name, rate: formatRatePercent(code.ratePercent) });

  const defaultInOptions = choice.options.some((option) => option.id === choice.defaultCode?.id);
  if (!choice.mayChoose || !defaultInOptions) {
    return (
      <p className="text-body-sm text-foreground" data-testid="invoice-tax">
        {t('readOnly', {
          name: choice.selected.name,
          rate: formatRatePercent(choice.selected.ratePercent),
        })}
      </p>
    );
  }

  return (
    <FormField htmlFor={id} label={t('label')} hint={t('hint')}>
      <Select
        id={id}
        value={choice.selected.id}
        onChange={(value) => choice.select(value)}
        disabled={disabled}
        searchable={false}
      >
        {choice.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.id === choice.defaultCode?.id
              ? `${label(option)} · ${t('defaultSuffix')}`
              : label(option)}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
