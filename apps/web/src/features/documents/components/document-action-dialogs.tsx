'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  DocumentCategory,
  DocumentDiscipline,
  DocumentRevisionPurpose,
  ProjectDocumentStatus,
  type DocumentRevisionResponse,
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
import { listProjectDocuments } from '../api/documents-api';

import {
  useArchiveDocument,
  useCreateRevision,
  useDeleteDocument,
  useIssueRevision,
  useReplaceRevisionFile,
  useSupersedeDocument,
  useUpdateDocument,
  useWithdrawDocument,
} from '../hooks/use-documents';

export type DocumentAction =
  | { kind: 'edit' }
  | { kind: 'new-revision' }
  | { kind: 'replace'; revision: DocumentRevisionResponse }
  | { kind: 'issue'; revision: DocumentRevisionResponse }
  | { kind: 'withdraw' }
  | { kind: 'supersede' }
  | { kind: 'archive' }
  | { kind: 'delete' };

/**
 * Every controlled act on a document, each in its own dialog.
 *
 * They are grouped in one file because they share one rule and it is easier to keep true in one
 * place: **the dialog states what the act does to the record before it does it.** Issuing freezes
 * a file permanently; withdrawing tells a site to stop building from something; discarding deletes
 * bytes. A confirm dialog that says "Are you sure?" has told the reader nothing they did not
 * already know from clicking the button.
 */
export function DocumentActionDialogs({
  projectId,
  detail,
  action,
  onClose,
}: {
  projectId: string;
  detail: ProjectDocumentDetailResponse;
  action: DocumentAction | null;
  onClose: () => void;
}) {
  if (!action) return null;
  const shared = { projectId, detail, onClose };

  switch (action.kind) {
    case 'edit':
      return <EditDialog {...shared} />;
    case 'new-revision':
      return <NewRevisionDialog {...shared} />;
    case 'replace':
      return <ReplaceFileDialog {...shared} revision={action.revision} />;
    case 'issue':
      return <IssueDialog {...shared} revision={action.revision} />;
    case 'withdraw':
      return <WithdrawDialog {...shared} />;
    case 'supersede':
      return <SupersedeDialog {...shared} />;
    case 'archive':
      return <ArchiveDialog {...shared} />;
    case 'delete':
      return <DeleteDialog {...shared} />;
  }
}

interface SharedProps {
  projectId: string;
  detail: ProjectDocumentDetailResponse;
  onClose: () => void;
}

function useActionError() {
  const t = useTranslations('documents');
  const [error, setError] = useState<string | null>(null);
  const report = (cause: unknown) =>
    setError(cause instanceof ApiError ? cause.message : t('states.actionFailed'));
  return { error, setError, report };
}

/**
 * Edit metadata.
 *
 * Which fields are offered depends on the status, mirroring `assertMetadataEditable`: a draft
 * admits everything; an issued document admits only the facts that describe the world rather than
 * the issued file. Its number and category are how the document is cited on a print somebody is
 * holding, so they are shown read-only rather than hidden — the reader should see that they are
 * fixed, not wonder where they went.
 */
function EditDialog({ projectId, detail, onClose }: SharedProps) {
  const t = useTranslations('documents');
  const { document } = detail;
  const isDraft = document.status === 'DRAFT';
  const { error, report } = useActionError();

  const [documentNumber, setDocumentNumber] = useState(document.documentNumber);
  const [title, setTitle] = useState(document.title);
  const [category, setCategory] = useState<string>(document.category);
  const [discipline, setDiscipline] = useState(document.discipline ?? '');
  const [responsibleUserId, setResponsibleUserId] = useState(document.responsibleUserId ?? '');
  const [issuerName, setIssuerName] = useState(document.issuerName ?? '');
  const [issuedAt, setIssuedAt] = useState(toDateInput(document.issuedAt));
  const [validFrom, setValidFrom] = useState(toDateInput(document.validFrom));
  const [expiresAt, setExpiresAt] = useState(toDateInput(document.expiresAt));

  const { data: members = [] } = useProjectMembers(projectId);
  const update = useUpdateDocument(projectId, document.id);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await update.mutateAsync({
        title: title.trim(),
        // `null` clears; the API distinguishes it from "not supplied", so the form must too —
        // otherwise an expiry date could never be removed once entered.
        responsibleUserId: responsibleUserId || null,
        issuerName: issuerName.trim() || null,
        issuedAt: issuedAt || null,
        validFrom: validFrom || null,
        expiresAt: expiresAt || null,
        ...(isDraft
          ? {
              documentNumber: documentNumber.trim(),
              category: category as DocumentCategory,
              discipline: (discipline || null) as DocumentDiscipline | null,
            }
          : {}),
      });
      onClose();
    } catch (cause) {
      report(cause);
    }
  }

  return (
    <ActionDialog title={t('form.editTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        {error ? <Alert variant="error" messages={[error]} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="edit-number" label={t('form.documentNumber')} required={isDraft}>
            <Input
              id="edit-number"
              value={documentNumber}
              disabled={!isDraft}
              onChange={(event) => setDocumentNumber(event.target.value)}
            />
          </FormField>

          <FormField htmlFor="edit-title" label={t('form.titleLabel')} required>
            <Input
              id="edit-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </FormField>

          <FormField htmlFor="edit-cat" label={t('form.category')}>
            <Select id="edit-cat" value={category} onChange={setCategory} disabled={!isDraft}>
              {Object.values(DocumentCategory).map((value) => (
                <option key={value} value={value}>
                  {t(`category.${value}`)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField htmlFor="edit-disc" label={t('form.discipline')}>
            <Select id="edit-disc" value={discipline} onChange={setDiscipline} disabled={!isDraft}>
              <option value="">{t('form.none')}</option>
              {Object.values(DocumentDiscipline).map((value) => (
                <option key={value} value={value}>
                  {t(`discipline.${value}`)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField htmlFor="edit-resp" label={t('form.responsible')} hint={t('form.responsibleHint')}>
            <Select id="edit-resp" value={responsibleUserId} onChange={setResponsibleUserId}>
              <option value="">{t('form.none')}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {`${member.user.firstName} ${member.user.lastName}`.trim()}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField htmlFor="edit-issuer" label={t('form.issuer')}>
            <Input
              id="edit-issuer"
              value={issuerName}
              onChange={(event) => setIssuerName(event.target.value)}
            />
          </FormField>

          <FormField htmlFor="edit-issued" label={t('form.issuedAt')}>
            <DatePicker
              id="edit-issued"
              value={issuedAt}
              onChange={setIssuedAt}
              clearLabel={t('actions.cancel')}
            />
          </FormField>

          <FormField htmlFor="edit-valid" label={t('form.validFrom')}>
            <DatePicker
              id="edit-valid"
              value={validFrom}
              onChange={setValidFrom}
              max={expiresAt || undefined}
              clearLabel={t('actions.cancel')}
            />
          </FormField>

          <FormField
            htmlFor="edit-expires"
            label={t('form.expiresAt')}
            hint={t('form.expiresAtHint')}
          >
            <DatePicker
              id="edit-expires"
              value={expiresAt}
              onChange={setExpiresAt}
              min={validFrom || undefined}
              clearLabel={t('actions.cancel')}
            />
          </FormField>
        </div>

        <DialogFooter>
          <Button type="submit" disabled={update.isPending}>
            {t('form.submitEdit')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        </DialogFooter>
      </form>
    </ActionDialog>
  );
}

function NewRevisionDialog({ projectId, detail, onClose }: SharedProps) {
  const t = useTranslations('documents');
  const { document } = detail;
  const { error, setError, report } = useActionError();

  const [file, setFile] = useState<File | null>(null);
  const [revisionCode, setRevisionCode] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');

  const upload = useFileUpload();
  const create = useCreateRevision(projectId, document.id);
  const isDrawing = document.category === DocumentCategory.DRAWING;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError(t('form.required'));
      return;
    }
    try {
      const platformFileId = await upload.mutateAsync(file);
      await create.mutateAsync({
        platformFileId,
        ...(revisionCode.trim() ? { revisionCode: revisionCode.trim() } : {}),
        ...(isDrawing && purpose ? { purpose: purpose as DocumentRevisionPurpose } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onClose();
    } catch (cause) {
      report(cause);
    }
  }

  return (
    <ActionDialog
      title={t('revision.newTitle')}
      description={t('revision.newHint')}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        {error ? <Alert variant="error" messages={[error]} /> : null}

        <FormField htmlFor="rev-code" label={t('form.revisionCode')}>
          <Input
            id="rev-code"
            value={revisionCode}
            placeholder={t('form.revisionCodePlaceholder')}
            onChange={(event) => setRevisionCode(event.target.value)}
          />
        </FormField>

        {isDrawing ? (
          <FormField htmlFor="rev-purpose" label={t('form.purpose')} hint={t('form.purposeHint')}>
            <Select id="rev-purpose" value={purpose} onChange={setPurpose}>
              <option value="">{t('form.none')}</option>
              {Object.values(DocumentRevisionPurpose).map((value) => (
                <option key={value} value={value}>
                  {t(`purpose.${value}`)}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        <FormField htmlFor="rev-file" label={t('form.file')} hint={t('form.fileHint')} required>
          <FileInput id="rev-file" onSelect={setFile} />
        </FormField>

        <FormField htmlFor="rev-notes" label={t('form.notes')}>
          <Textarea
            id="rev-notes"
            rows={2}
            maxLength={300}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </FormField>

        <DialogFooter>
          <Button type="submit" disabled={upload.isPending || create.isPending}>
            {upload.isPending ? t('states.uploading') : t('actions.newRevision')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        </DialogFooter>
      </form>
    </ActionDialog>
  );
}

function ReplaceFileDialog({
  projectId,
  detail,
  revision,
  onClose,
}: SharedProps & { revision: DocumentRevisionResponse }) {
  const t = useTranslations('documents');
  const { error, setError, report } = useActionError();
  const [file, setFile] = useState<File | null>(null);

  const upload = useFileUpload();
  const replace = useReplaceRevisionFile(projectId, detail.document.id);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError(t('form.required'));
      return;
    }
    try {
      const platformFileId = await upload.mutateAsync(file);
      await replace.mutateAsync({ revisionId: revision.id, platformFileId });
      onClose();
    } catch (cause) {
      report(cause);
    }
  }

  return (
    <ActionDialog
      title={t('revision.replaceTitle')}
      description={t('revision.replaceHint')}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        {error ? <Alert variant="error" messages={[error]} /> : null}
        <FormField htmlFor="replace-file" label={t('form.file')} required>
          <FileInput id="replace-file" onSelect={setFile} />
        </FormField>
        <DialogFooter>
          <Button type="submit" disabled={upload.isPending || replace.isPending}>
            {upload.isPending ? t('states.uploading') : t('actions.replaceFile')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        </DialogFooter>
      </form>
    </ActionDialog>
  );
}

/**
 * Issue.
 *
 * The one act in the register with permanent consequences, so the dialog says exactly what they
 * are rather than asking for confirmation of something unstated: the file is locked for good, and
 * whatever was current before becomes history without losing its file.
 */
function IssueDialog({
  projectId,
  detail,
  revision,
  onClose,
}: SharedProps & { revision: DocumentRevisionResponse }) {
  const t = useTranslations('documents');
  const { error, report } = useActionError();
  const [issuedAt, setIssuedAt] = useState('');
  const [revisionCode, setRevisionCode] = useState(revision.revisionCode ?? '');
  const [purpose, setPurpose] = useState(revision.purpose ?? '');

  const issue = useIssueRevision(projectId, detail.document.id);
  const isDrawing = detail.document.category === DocumentCategory.DRAWING;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await issue.mutateAsync({
        revisionId: revision.id,
        ...(issuedAt ? { issuedAt } : {}),
        ...(revisionCode.trim() ? { revisionCode: revisionCode.trim() } : {}),
        ...(isDrawing && purpose ? { purpose: purpose as DocumentRevisionPurpose } : {}),
      });
      onClose();
    } catch (cause) {
      report(cause);
    }
  }

  return (
    <ActionDialog
      title={t('revision.issueTitle', {
        code: revision.revisionCode ?? t('revision.number', { number: revision.revisionNumber }),
      })}
      description={t('revision.issueHint')}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        {error ? <Alert variant="error" messages={[error]} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="issue-code" label={t('form.revisionCode')}>
            <Input
              id="issue-code"
              value={revisionCode}
              placeholder={t('form.revisionCodePlaceholder')}
              onChange={(event) => setRevisionCode(event.target.value)}
            />
          </FormField>

          <FormField htmlFor="issue-date" label={t('form.issuedAt')}>
            <DatePicker
              id="issue-date"
              value={issuedAt}
              onChange={setIssuedAt}
              clearLabel={t('actions.cancel')}
            />
          </FormField>

          {isDrawing ? (
            <FormField
              htmlFor="issue-purpose"
              label={t('form.purpose')}
              hint={t('form.purposeHint')}
            >
              <Select id="issue-purpose" value={purpose} onChange={setPurpose}>
                <option value="">{t('form.none')}</option>
                {Object.values(DocumentRevisionPurpose).map((value) => (
                  <option key={value} value={value}>
                    {t(`purpose.${value}`)}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="submit" disabled={issue.isPending}>
            {t('revision.issueConfirm')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        </DialogFooter>
      </form>
    </ActionDialog>
  );
}

function WithdrawDialog({ projectId, detail, onClose }: SharedProps) {
  const t = useTranslations('documents');
  const { error, setError, report } = useActionError();
  const [reason, setReason] = useState('');
  const withdraw = useWithdrawDocument(projectId, detail.document.id);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError(t('form.required'));
      return;
    }
    try {
      await withdraw.mutateAsync(reason.trim());
      onClose();
    } catch (cause) {
      report(cause);
    }
  }

  return (
    <ActionDialog title={t('withdraw.title')} description={t('withdraw.body')} onClose={onClose}>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        {error ? <Alert variant="error" messages={[error]} /> : null}
        <FormField htmlFor="withdraw-reason" label={t('withdraw.reason')} required>
          <Textarea
            id="withdraw-reason"
            rows={3}
            maxLength={300}
            value={reason}
            placeholder={t('withdraw.reasonPlaceholder')}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </FormField>
        <DialogFooter>
          <Button type="submit" variant="destructive" disabled={withdraw.isPending}>
            {t('withdraw.confirm')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        </DialogFooter>
      </form>
    </ActionDialog>
  );
}

/**
 * Supersede with another document.
 *
 * The candidate list is fetched here rather than passed in, because it is a different question
 * from "what is on the register page" — only issued documents on this project, excluding this one,
 * can replace it. When there are none the dialog says so instead of offering an empty picker.
 */
function SupersedeDialog({ projectId, detail, onClose }: SharedProps) {
  const t = useTranslations('documents');
  const { error, setError, report } = useActionError();
  const [candidates, setCandidates] = useState<{ id: string; label: string }[] | null>(null);
  const [selected, setSelected] = useState('');
  const supersede = useSupersedeDocument(projectId, detail.document.id);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    listProjectDocuments(projectId, { status: ProjectDocumentStatus.ISSUED, pageSize: 100 })
      .then((page) =>
        setCandidates(
          page.items
            .filter((item) => item.id !== detail.document.id)
            .map((item) => ({ id: item.id, label: `${item.documentNumber} — ${item.title}` })),
        ),
      )
      .catch(() => setCandidates([]));
  }, [projectId, detail.document.id]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!selected) {
      setError(t('form.required'));
      return;
    }
    try {
      await supersede.mutateAsync(selected);
      onClose();
    } catch (cause) {
      report(cause);
    }
  }

  return (
    <ActionDialog title={t('supersede.title')} description={t('supersede.body')} onClose={onClose}>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        {error ? <Alert variant="error" messages={[error]} /> : null}
        {candidates && candidates.length === 0 ? (
          <Alert variant="info" messages={[t('supersede.noCandidates')]} />
        ) : (
          <FormField htmlFor="supersede-target" label={t('supersede.replacement')} required>
            <Select id="supersede-target" value={selected} onChange={setSelected} required>
              <option value="">{t('form.none')}</option>
              {(candidates ?? []).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <DialogFooter>
          <Button
            type="submit"
            disabled={supersede.isPending || !candidates || candidates.length === 0}
          >
            {t('supersede.confirm')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        </DialogFooter>
      </form>
    </ActionDialog>
  );
}

function ArchiveDialog({ projectId, detail, onClose }: SharedProps) {
  const t = useTranslations('documents');
  const { error, report } = useActionError();
  const archive = useArchiveDocument(projectId, detail.document.id);

  return (
    <ActionDialog title={t('archive.title')} description={t('archive.body')} onClose={onClose}>
      <div className="mt-5 space-y-4">
        {error ? <Alert variant="error" messages={[error]} /> : null}
        <DialogFooter>
          <Button
            disabled={archive.isPending}
            onClick={async () => {
              try {
                await archive.mutateAsync(undefined);
                onClose();
              } catch (cause) {
                report(cause);
              }
            }}
          >
            {t('archive.confirm')}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        </DialogFooter>
      </div>
    </ActionDialog>
  );
}

function DeleteDialog({ projectId, detail, onClose }: SharedProps) {
  const t = useTranslations('documents');
  const router = useRouter();
  const { error, report } = useActionError();
  const remove = useDeleteDocument(projectId);

  return (
    <ActionDialog
      title={t('delete.title')}
      description={t('delete.body', { title: detail.document.title })}
      onClose={onClose}
    >
      <div className="mt-5 space-y-4">
        {error ? <Alert variant="error" messages={[error]} /> : null}
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={async () => {
              try {
                await remove.mutateAsync(detail.document.id);
                onClose();
                router.push(`/projects/${projectId}/documents`);
              } catch (cause) {
                report(cause);
              }
            }}
          >
            {t('delete.confirm')}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        </DialogFooter>
      </div>
    </ActionDialog>
  );
}

function ActionDialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations('documents');
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('actions.cancel')} className="max-w-xl">
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        {children}
      </DialogContent>
    </Dialog>
  );
}

function FileInput({ id, onSelect }: { id: string; onSelect: (file: File | null) => void }) {
  return (
    <input
      id={id}
      type="file"
      required
      onChange={(event) => onSelect(event.target.files?.[0] ?? null)}
      className="block min-h-11 w-full cursor-pointer rounded-input border border-border bg-surface px-3 py-2 text-body-sm text-foreground file:me-3 file:rounded-control file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-body-sm file:font-medium file:text-foreground"
    />
  );
}

/** `@db.Date` columns serialize as full ISO strings; the picker wants `yyyy-MM-dd`. */
function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}
