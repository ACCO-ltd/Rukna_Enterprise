'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
  Textarea,
} from '@erp/ui';

import { useEditDraftInvoice } from '../hooks/use-commercial-invoice';

/**
 * Edit a draft's terms: due date, payment terms, notes (`PATCH …/commercial/invoices/:id`).
 * Amounts and lines are fixed by the stage and its variations — to change those, delete the
 * draft and prepare it again.
 */
export function InvoiceEditDraftDialog({
  open,
  onOpenChange,
  projectId,
  invoiceId,
  dueDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  invoiceId: string;
  /** The draft's current due date (yyyy-MM-dd or ISO), if any. */
  dueDate: string | null;
}) {
  const t = useTranslations('commercial.invoicePage.editDraftForm');
  const mutation = useEditDraftInvoice(projectId, invoiceId);

  const initialDue = dueDate ? dueDate.slice(0, 10) : '';
  const [due, setDue] = useState(initialDue);
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');

  function handleOpenChange(next: boolean) {
    if (!next && mutation.isPending) return;
    if (!next) {
      setDue(initialDue);
      setTerms('');
      setNotes('');
      mutation.reset();
    }
    onOpenChange(next);
  }

  function save() {
    // Only what the user touched is sent — a blank terms/notes field means "leave as is", not
    // "clear it".
    mutation.mutate(
      {
        ...(due !== initialDue ? { dueDate: due || null } : {}),
        ...(terms.trim() ? { paymentTerms: terms.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
      { onSuccess: () => handleOpenChange(false) },
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('title')}
      subtitle={t('description')}
      size="md"
      dirty={due !== initialDue || terms !== '' || notes !== ''}
      busy={mutation.isPending}
    >
      <FormDialogBody>
        {mutation.isError ? (
          <Alert variant="error" messages={[mutation.error.message || t('failed')]} />
        ) : null}
        <FormField htmlFor="ed-due" label={t('dueDate')}>
          <DatePicker id="ed-due" value={due} onChange={setDue} />
        </FormField>
        <FormField htmlFor="ed-terms" label={t('paymentTerms')} hint={t('paymentTermsHint')}>
          <Input
            id="ed-terms"
            value={terms}
            onChange={(event) => setTerms(event.target.value)}
            maxLength={100}
            disabled={mutation.isPending}
          />
        </FormField>
        <FormField htmlFor="ed-notes" label={t('notes')}>
          <Textarea
            id="ed-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            disabled={mutation.isPending}
          />
        </FormField>
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={mutation.isPending}>
            {t('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="button" onClick={save} disabled={mutation.isPending}>
          {mutation.isPending ? t('saving') : t('save')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
