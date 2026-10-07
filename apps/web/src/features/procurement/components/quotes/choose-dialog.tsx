'use client';

/**
 * "Choose {store} — $2,350.00" (wireframe E). In the common case — the lowest quote, enough
 * stores — the only question is Pay by: one tap and Choose. A non-lowest choice adds reason chips
 * (Other needs a few words); a short request adds the exception acceptance; a winning new store
 * that matches registered suppliers offers them instead of registering a duplicate.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  CheckboxField,
  ChoiceCards,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Notice,
  Textarea,
} from '@erp/ui';

import type {
  AwardPayload,
  NonLowestReason,
  Quote,
  QuotationPaymentPath,
  QuotationRequestDetail,
} from '../../quotations/types';

const NON_LOWEST: NonLowestReason[] = ['FASTER_DELIVERY', 'BETTER_QUALITY', 'HAS_STOCK', 'OTHER'];
const PAY_BY: QuotationPaymentPath[] = ['BUYER_CASH', 'FINANCE_PAYS_SUPPLIER'];
const NEW_SUPPLIER = '__new__';

export function ChooseDialog({
  detail,
  quote,
  totalText,
  lowestText,
  isLowest,
  canRegisterSupplier,
  busy,
  error,
  onChoose,
  onClose,
}: {
  detail: QuotationRequestDetail;
  quote: Quote;
  /** The chosen quote's total, formatted. */
  totalText: string;
  /** The lowest total, formatted — shown when this one is not it. */
  lowestText: string | null;
  isLowest: boolean;
  /** Holds manage:payable — may register a new store as a supplier on award. */
  canRegisterSupplier: boolean;
  busy: boolean;
  error: string | null;
  onChoose: (payload: AwardPayload) => void;
  onClose: () => void;
}) {
  const t = useTranslations('procurement.quotes.decision.chooseDialog');
  const tReason = useTranslations('procurement.quotes.nonLowestReason');
  const tPay = useTranslations('procurement.quotes.paymentPath');
  const tException = useTranslations('procurement.quotes.exceptionReason');
  const tCommon = useTranslations('common');

  const [reason, setReason] = useState<NonLowestReason | ''>('');
  const [note, setNote] = useState('');
  const [payBy, setPayBy] = useState<QuotationPaymentPath | ''>('');
  const [accept, setAccept] = useState(false);
  const matches = detail.supplierMatches.find((m) => m.quoteId === quote.id)?.suppliers ?? [];
  const offerMatches = !quote.store.registered && matches.length > 0;
  // A matching registered supplier is the default; registering a new one is an explicit choice.
  const [supplier, setSupplier] = useState<string>(() => (offerMatches ? matches[0]!.id : NEW_SUPPLIER));
  const [tried, setTried] = useState(false);

  const short = detail.distinctSupplierCount < detail.requiredQuoteCount;
  const registersNew = !quote.store.registered && supplier === NEW_SUPPLIER;
  // The server refuses a new store without manage:payable (SUPPLIER_REGISTRATION_REQUIRES_PAYABLES);
  // say so up front rather than after the tap. The server still decides.
  const cannotRegister = registersNew && !canRegisterSupplier;

  const missing = {
    reason: !isLowest && !reason,
    note: !isLowest && reason === 'OTHER' && note.trim() === '',
    accept: short && !accept,
    payBy: !payBy,
  };
  const invalid = Object.values(missing).some(Boolean) || cannotRegister;

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="md"
      title={t('title', { store: quote.store.name, total: totalText })}
      busy={busy}
      dirty={Boolean(reason || payBy || note)}
      closeLabel={tCommon('close')}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (invalid || !payBy) return;
        onChoose({
          quoteId: quote.id,
          paymentPath: payBy,
          ...(isLowest ? {} : { nonLowestReason: reason as NonLowestReason }),
          ...(!isLowest && reason === 'OTHER' ? { nonLowestNote: note.trim() } : {}),
          ...(short ? { acceptException: true } : {}),
          ...(offerMatches && supplier !== NEW_SUPPLIER ? { awardSupplierId: supplier } : {}),
        });
      }}
    >
      <FormDialogBody className="space-y-5">
        {error ? <Alert variant="error" messages={[error]} /> : null}

        {!isLowest ? (
          <div className="space-y-3">
            <ChoiceCards
              label={t('notLowest', { lowest: lowestText ?? '' })}
              value={reason}
              onChange={setReason}
              columns={2}
              options={NON_LOWEST.map((value) => ({ value, label: tReason(value) }))}
            />
            {tried && missing.reason ? (
              <p role="alert" className="text-caption text-danger">
                {t('pickReason')}
              </p>
            ) : null}
            {reason === 'OTHER' ? (
              <FormField
                htmlFor="choose-other-note"
                label={t('otherNote')}
                required
                error={tried && missing.note ? t('otherNoteRequired') : undefined}
              >
                <Textarea id="choose-other-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </FormField>
            ) : null}
          </div>
        ) : null}

        {short ? (
          <Notice tone="attention" title={t('exception')}>
            <CheckboxField
              id="choose-accept-exception"
              checked={accept}
              onChange={(e) => setAccept(e.target.checked)}
              label={t('exceptionAccept', {
                count: detail.distinctSupplierCount,
                required: detail.requiredQuoteCount,
                reason: detail.exceptionReason ? tException(detail.exceptionReason) : '—',
              })}
            />
            {tried && missing.accept ? (
              <p role="alert" className="text-caption text-danger">
                {t('exceptionRequired')}
              </p>
            ) : null}
          </Notice>
        ) : null}

        {registersNew && !offerMatches ? (
          <Notice tone={cannotRegister ? 'attention' : 'info'}>
            {cannotRegister ? t('registerNeedsPayables') : t('registersNew', { name: quote.store.name })}
          </Notice>
        ) : null}
        {offerMatches && cannotRegister ? <Notice tone="attention">{t('registerNeedsPayables')}</Notice> : null}

        {offerMatches ? (
          <ChoiceCards
            label={t('supplier')}
            value={supplier}
            onChange={setSupplier}
            columns={1}
            options={[
              ...matches.map((m) => ({
                value: m.id,
                label: t('supplierExisting', { name: m.name }),
                hint: m.code ? t('supplierExistingHint', { code: m.code }) : undefined,
              })),
              { value: NEW_SUPPLIER, label: t('supplierNew', { name: quote.store.name }), hint: t('supplierNewHint') },
            ]}
          />
        ) : null}

        <div className="space-y-2">
          <ChoiceCards
            label={t('payBy')}
            value={payBy}
            onChange={setPayBy}
            columns={2}
            options={PAY_BY.map((value) => ({ value, label: tPay(value), hint: tPay(`${value}_HINT`) }))}
          />
          {tried && missing.payBy ? (
            <p role="alert" className="text-caption text-danger">
              {t('payByRequired')}
            </p>
          ) : null}
        </div>
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="ghost" className="min-h-11">
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" className="min-h-11" loading={busy} disabled={cannotRegister}>
          {t('confirm')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
