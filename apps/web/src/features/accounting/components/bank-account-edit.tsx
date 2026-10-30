'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  CheckboxField,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
  Select,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { useUpdateBankAccount } from '../hooks/use-accounting';
import type { BankAccount, BankAccountKind } from '../types';

/** The placeholder setup stores when no account number was given ("Not recorded (10100)"). */
export function accountNumberRecorded(accountNumber: string): boolean {
  return !/^Not recorded \(/.test(accountNumber);
}

/**
 * B-1 — correct a bank account's name, bank, number or what it is used for. The GL account it
 * posts to never changes. A `FormDialog` (ADR-039).
 */
export function EditBankAccountDialog({ bank, onClose }: { bank: BankAccount; onClose: () => void }) {
  const t = useTranslations('accounting.bankAccounts.edit');
  const tKind = useTranslations('accounting.bankAccounts.kind');
  const [kind, setKind] = useState<BankAccountKind>(bank.kind ?? 'BANK');
  const mutation = useUpdateBankAccount();
  const [accountName, setAccountName] = useState(bank.accountName);
  const [bankName, setBankName] = useState(bank.bankName);
  const [accountNumber, setAccountNumber] = useState(accountNumberRecorded(bank.accountNumber) ? bank.accountNumber : '');
  const [allowsReceipts, setAllowsReceipts] = useState(bank.allowsReceipts);
  const [allowsPayments, setAllowsPayments] = useState(bank.allowsPayments);
  const [attempted, setAttempted] = useState(false);

  const missing = (v: string) => attempted && !v.trim();
  function save() {
    setAttempted(true);
    if (!accountName.trim() || !bankName.trim()) return;
    mutation.mutate(
      {
        id: bank.id,
        payload: {
          accountName: accountName.trim(),
          bankName: bankName.trim(),
          ...(accountNumber.trim() ? { accountNumber: accountNumber.trim() } : {}),
          kind,
          allowsReceipts,
          allowsPayments,
        },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}
      title={t('title')}
      subtitle={bank.accountName}
      size="md"
      dirty={kind !== (bank.kind ?? 'BANK') || accountName !== bank.accountName || bankName !== bank.bankName || allowsReceipts !== bank.allowsReceipts || allowsPayments !== bank.allowsPayments}
      busy={mutation.isPending}
    >
      <FormDialogBody>
        {mutation.isError ? <Alert variant="error" messages={[mutation.error instanceof ApiError ? mutation.error.message : t('failed')]} /> : null}
        <FormField htmlFor="ba-name" label={t('accountName')} error={missing(accountName) ? t('required') : undefined} required>
          <Input id="ba-name" value={accountName} onChange={(e) => setAccountName(e.target.value)} maxLength={255} />
        </FormField>
        <FormField htmlFor="ba-bank" label={t('bankName')} error={missing(bankName) ? t('required') : undefined} required>
          <Input id="ba-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={255} />
        </FormField>
        <FormField htmlFor="ba-number" label={t('accountNumber')} hint={accountNumberRecorded(bank.accountNumber) ? undefined : t('numberMissingHint')}>
          <Input id="ba-number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} maxLength={50} />
        </FormField>
        <FormField htmlFor="ba-kind" label={t('kind')}>
          <Select id="ba-kind" value={kind} onChange={(value) => setKind(value as BankAccountKind)}>
            {(['BANK', 'CASH', 'MOBILE_WALLET'] as const).map((k) => (
              <option key={k} value={k}>
                {tKind(k)}
              </option>
            ))}
          </Select>
        </FormField>
        <CheckboxField id="ba-receipts" label={t('allowsReceipts')} checked={allowsReceipts} onChange={(e) => setAllowsReceipts(e.target.checked)} />
        <CheckboxField id="ba-payments" label={t('allowsPayments')} checked={allowsPayments} onChange={(e) => setAllowsPayments(e.target.checked)} />
        <p className="text-caption text-muted-foreground">{t('glNote')}</p>
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={mutation.isPending}>{t('cancel')}</Button>
        </FormDialogClose>
        <Button type="button" onClick={save} loading={mutation.isPending}>{t('save')}</Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
