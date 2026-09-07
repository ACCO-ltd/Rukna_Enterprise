'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  DocumentCategory,
  DocumentDiscipline,
  DocumentRevisionPurpose,
  type ProjectDocumentDetailResponse,
} from '@erp/types';
import {
  Alert,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
  Select,
  Textarea,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { useProjectMembers } from '@/features/projects/hooks/use-project-members';
import { useFileUpload } from '@/features/files/hooks/use-file-upload';

import { useCreateDocument } from '../hooks/use-documents';

/**
 * Register a controlled document.
 *
 * **Metadata first, file last.** The old Documents tab was an upload form with a title box beside
 * it, which taught everyone that a document *is* a file. It is not: a controlled document is
 * identified by its number, classified, owned by a responsible person and valid for a period, and
 * the file is the content of its first revision. The form is ordered to say so, and the file field
 * carries the sentence that matters — uploading is not issuing.
 *
 * The upload runs first and independently: presign → PUT → confirm produces a READY file id, which
 * is then registered. A failure between the two leaves a TEMPORARY file that the abandoned-upload
 * sweep reclaims, which is why the file is never left orphaned by a validation error here.
 */
export function RegisterDocumentDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('documents');
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [documentNumber, setDocumentNumber] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>(DocumentCategory.DRAWING);
  const [discipline, setDiscipline] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [issuerName, setIssuerName] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [revisionCode, setRevisionCode] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: members = [] } = useProjectMembers(projectId);
  const upload = useFileUpload();
  const create = useCreateDocument(projectId);
  const busy = upload.isPending || create.isPending;

  // Purpose is drawing vocabulary. "Issued for construction" on an insurance certificate would
  // tell the site to build from a policy document, so the field is not offered at all elsewhere —
  // and the server refuses it independently.
  const isDrawing = category === DocumentCategory.DRAWING;

  function reset() {
    setDocumentNumber('');
    setTitle('');
    setCategory(DocumentCategory.DRAWING);
    setDiscipline('');
    setResponsibleUserId('');
    setIssuerName('');
    setIssuedAt('');
    setValidFrom('');
    setExpiresAt('');
    setRevisionCode('');
    setPurpose('');
    setNotes('');
    setFile(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!documentNumber.trim() || !title.trim() || !file) {
      setError(t('form.required'));
      return;
    }

    try {
      const platformFileId = await upload.mutateAsync(file);
      const detail = (await create.mutateAsync({
        documentNumber: documentNumber.trim(),
        title: title.trim(),
        category: category as DocumentCategory,
        ...(discipline ? { discipline: discipline as DocumentDiscipline } : {}),
        ...(responsibleUserId ? { responsibleUserId } : {}),
        ...(issuerName.trim() ? { issuerName: issuerName.trim() } : {}),
        ...(issuedAt ? { issuedAt } : {}),
        ...(validFrom ? { validFrom } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        platformFileId,
        ...(revisionCode.trim() ? { revisionCode: revisionCode.trim() } : {}),
        ...(isDrawing && purpose ? { purpose: purpose as DocumentRevisionPurpose } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })) as ProjectDocumentDetailResponse;
      reset();
      onOpenChange(false);
      // Straight to the record just created: the next act is almost always to issue it, and
      // that lives on the detail page.
      router.push(`/projects/${projectId}/documents/${detail.document.id}`);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : t('states.saveFailed'),
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent closeLabel={t('actions.cancel')} className="max-w-2xl">
        <DialogTitle>{t('form.registerTitle')}</DialogTitle>
        <DialogDescription>{t('form.registerHint')}</DialogDescription>

        <form onSubmit={onSubmit} className="mt-5 space-y-6">
          {error ? <Alert variant="error" messages={[error]} /> : null}

          <section className="space-y-4">
            <h3 className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {t('form.identitySection')}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                htmlFor="doc-number"
                label={t('form.documentNumber')}
                hint={t('form.documentNumberHint')}
                required
              >
                <Input
                  id="doc-number"
                  value={documentNumber}
                  placeholder={t('form.documentNumberPlaceholder')}
                  onChange={(event) => setDocumentNumber(event.target.value)}
                  required
                />
              </FormField>

              <FormField htmlFor="doc-title" label={t('form.titleLabel')} required>
                <Input
                  id="doc-title"
                  value={title}
                  placeholder={t('form.titlePlaceholder')}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                />
              </FormField>

              <FormField htmlFor="doc-cat" label={t('form.category')} required>
                <Select id="doc-cat" value={category} onChange={setCategory} required>
                  {Object.values(DocumentCategory).map((value) => (
                    <option key={value} value={value}>
                      {t(`category.${value}`)}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField
                htmlFor="doc-disc"
                label={t('form.discipline')}
                hint={t('form.disciplineHint')}
              >
                <Select id="doc-disc" value={discipline} onChange={setDiscipline}>
                  <option value="">{t('form.none')}</option>
                  {Object.values(DocumentDiscipline).map((value) => (
                    <option key={value} value={value}>
                      {t(`discipline.${value}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {t('form.responsibilitySection')}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                htmlFor="doc-resp"
                label={t('form.responsible')}
                hint={t('form.responsibleHint')}
              >
                <Select id="doc-resp" value={responsibleUserId} onChange={setResponsibleUserId}>
                  <option value="">{t('form.none')}</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {`${member.user.firstName} ${member.user.lastName}`.trim()}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField htmlFor="doc-issuer" label={t('form.issuer')}>
                <Input
                  id="doc-issuer"
                  value={issuerName}
                  placeholder={t('form.issuerPlaceholder')}
                  onChange={(event) => setIssuerName(event.target.value)}
                />
              </FormField>

              <FormField htmlFor="doc-issued" label={t('form.issuedAt')}>
                <DatePicker
                  id="doc-issued"
                  value={issuedAt}
                  onChange={setIssuedAt}
                  clearLabel={t('actions.cancel')}
                />
              </FormField>

              <FormField htmlFor="doc-valid-from" label={t('form.validFrom')}>
                <DatePicker
                  id="doc-valid-from"
                  value={validFrom}
                  onChange={setValidFrom}
                  // The window must be a real one; the server refuses the inverse too.
                  max={expiresAt || undefined}
                  clearLabel={t('actions.cancel')}
                />
              </FormField>

              <FormField
                htmlFor="doc-expires"
                label={t('form.expiresAt')}
                hint={t('form.expiresAtHint')}
              >
                <DatePicker
                  id="doc-expires"
                  value={expiresAt}
                  onChange={setExpiresAt}
                  min={validFrom || undefined}
                  clearLabel={t('actions.cancel')}
                />
              </FormField>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {t('form.fileSection')}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField htmlFor="doc-rev-code" label={t('form.revisionCode')}>
                <Input
                  id="doc-rev-code"
                  value={revisionCode}
                  placeholder={t('form.revisionCodePlaceholder')}
                  onChange={(event) => setRevisionCode(event.target.value)}
                />
              </FormField>

              {isDrawing ? (
                <FormField htmlFor="doc-purpose" label={t('form.purpose')} hint={t('form.purposeHint')}>
                  <Select id="doc-purpose" value={purpose} onChange={setPurpose}>
                    <option value="">{t('form.none')}</option>
                    {Object.values(DocumentRevisionPurpose).map((value) => (
                      <option key={value} value={value}>
                        {t(`purpose.${value}`)}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}

              <FormField
                htmlFor="doc-file"
                label={t('form.file')}
                hint={t('form.fileHint')}
                required
                className="sm:col-span-2"
              >
                <input
                  id="doc-file"
                  ref={fileInput}
                  type="file"
                  required
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="block min-h-11 w-full cursor-pointer rounded-input border border-border bg-surface px-3 py-2 text-body-sm text-foreground file:me-3 file:rounded-control file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-body-sm file:font-medium file:text-foreground"
                />
              </FormField>

              <FormField htmlFor="doc-notes" label={t('form.notes')} className="sm:col-span-2">
                <Textarea
                  id="doc-notes"
                  rows={2}
                  value={notes}
                  maxLength={300}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </FormField>
            </div>
          </section>

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {upload.isPending ? t('states.uploading') : t('form.submit')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t('actions.cancel')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
