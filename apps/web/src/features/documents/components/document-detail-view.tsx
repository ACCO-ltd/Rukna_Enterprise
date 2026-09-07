'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { DocumentRevisionResponse, ProjectDocumentDetailResponse } from '@erp/types';
import {
  Alert,
  Badge,
  Button,
  DefinitionList,
  DefinitionRow,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  RecordPanel,
  SkeletonRecord,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  cn,
} from '@erp/ui';
import { ArrowLeft, Download, MoreHorizontal } from 'lucide-react';

import { formatDate } from '@/lib/format';
import { getFileDownloadUrl } from '@/features/files/api/files-api';

import { useDocumentCapabilities, useProjectDocument } from '../hooks/use-documents';
import {
  DateCell,
  DocumentStatusChip,
  PersonCell,
  RevisionStatusChip,
  ValidityChip,
  formatBytes,
} from './document-primitives';
import { DocumentActionDialogs, type DocumentAction } from './document-action-dialogs';

/**
 * One controlled document: what it is, which revision is current, what came before, and what
 * happened to it.
 *
 * Its own route rather than a sheet, because revision history and activity grow without bound and
 * because a document number is something people send each other — a drawing revision worth
 * arguing about needs a URL.
 *
 * The action set is derived from the *server's* capability flags combined with the document's own
 * status, never from a permission string the browser interprets. A hidden button and a refused
 * request must agree, and only one side can be the authority.
 */
export function DocumentDetailView({
  projectId,
  documentId,
}: {
  projectId: string;
  documentId: string;
}) {
  const t = useTranslations('documents');
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();

  const query = useProjectDocument(projectId, documentId);
  const capabilities = useDocumentCapabilities(projectId);
  const [action, setAction] = useState<DocumentAction | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function openFile(fileId: string) {
    setDownloadError(null);
    try {
      const { url } = await getFileDownloadUrl(fileId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setDownloadError(t('states.downloadFailed'));
    }
  }

  if (query.isPending) return <SkeletonRecord label={t('states.loading')} />;
  if (query.isError) {
    return (
      <Alert variant="error" title={t('states.detailLoadFailed')} messages={[t('states.notFound')]}>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('actions.retry')}
          </Button>
          <Button variant="ghost" onClick={() => router.push(`/projects/${projectId}/documents`)}>
            {t('actions.back')}
          </Button>
        </div>
      </Alert>
    );
  }

  const { document, revisions, activity } = query.data;
  const current = revisions.find((revision) => revision.isCurrent) ?? null;
  const draft = revisions.find((revision) => revision.status === 'DRAFT') ?? null;
  const canEdit = Boolean(capabilities.data?.canEdit);
  const canIssue = Boolean(capabilities.data?.canIssue);

  // Every one of these mirrors a server-side guard in document-lifecycle.policy.ts. When they
  // drift, the server wins and the user gets a sentence instead of a hidden button.
  const isTerminal = ['SUPERSEDED', 'WITHDRAWN', 'ARCHIVED'].includes(document.status);
  const showIssue = canIssue && Boolean(draft) && !isTerminal;
  const showNewRevision = canEdit && document.status === 'ISSUED' && !draft;
  const showReplace = canEdit && Boolean(draft);
  const showWithdraw = canIssue && document.status === 'ISSUED';
  const showSupersede = canIssue && document.status === 'ISSUED';
  const showArchive = canIssue && document.status !== 'ARCHIVED';
  const showDelete =
    canEdit &&
    document.status === 'DRAFT' &&
    revisions.every((revision) => revision.status === 'DRAFT');

  const hasMenu = showNewRevision || showReplace || showWithdraw || showSupersede || showArchive || showDelete;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/documents`}
          className="inline-flex min-h-11 items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} strokeWidth={1.9} aria-hidden="true" />
          {t('actions.back')}
        </Link>
      </div>

      {downloadError ? <Alert variant="error" messages={[downloadError]} /> : null}

      {/* Header: the three axes side by side, never merged. Status is where the record is,
          the revision chip is which issue is current, validity is whether it can be relied on. */}
      <section className="border-y border-border bg-surface px-1 py-4 sm:px-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-h1 font-semibold leading-tight text-foreground">{document.title}</h1>
            <p className="mt-1 font-mono text-body-sm text-muted-foreground">
              {document.documentNumber}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <DocumentStatusChip status={document.status} />
              {current ? (
                <Badge tone="neutral">
                  {current.revisionCode ?? t('revision.number', { number: current.revisionNumber })}
                </Badge>
              ) : null}
              <ValidityChip
                validity={document.validity}
                daysUntilExpiry={document.daysUntilExpiry}
              />
              {current?.purpose ? (
                <Badge tone="accent">{t(`purpose.${current.purpose}`)}</Badge>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {showIssue && draft ? (
              <Button onClick={() => setAction({ kind: 'issue', revision: draft })}>
                {t('actions.issue')}
              </Button>
            ) : null}
            {canEdit && !isTerminal ? (
              <Button variant="outline" onClick={() => setAction({ kind: 'edit' })}>
                {t('actions.edit')}
              </Button>
            ) : null}
            {hasMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={t('actions.more')}>
                    <MoreHorizontal size={16} strokeWidth={1.9} aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {showNewRevision ? (
                    <DropdownMenuItem onSelect={() => setAction({ kind: 'new-revision' })}>
                      {t('actions.newRevision')}
                    </DropdownMenuItem>
                  ) : null}
                  {showReplace && draft ? (
                    <DropdownMenuItem onSelect={() => setAction({ kind: 'replace', revision: draft })}>
                      {t('actions.replaceFile')}
                    </DropdownMenuItem>
                  ) : null}
                  {showWithdraw ? (
                    <DropdownMenuItem onSelect={() => setAction({ kind: 'withdraw' })}>
                      {t('actions.withdraw')}
                    </DropdownMenuItem>
                  ) : null}
                  {showSupersede ? (
                    <DropdownMenuItem onSelect={() => setAction({ kind: 'supersede' })}>
                      {t('actions.supersede')}
                    </DropdownMenuItem>
                  ) : null}
                  {showArchive ? (
                    <DropdownMenuItem onSelect={() => setAction({ kind: 'archive' })}>
                      {t('actions.archive')}
                    </DropdownMenuItem>
                  ) : null}
                  {showDelete ? (
                    <DropdownMenuItem onSelect={() => setAction({ kind: 'delete' })}>
                      {t('actions.delete')}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>

        {/* A terminal state without its reason is a dead end. Both are stated where the reader
            is already looking, not buried in the activity log. */}
        {document.status === 'WITHDRAWN' && document.withdrawnReason ? (
          <div className="mt-3">
            <Alert
              variant="warning"
              messages={[t('detail.withdrawnReason', { reason: document.withdrawnReason })]}
            />
          </div>
        ) : null}
        {document.status === 'SUPERSEDED' && document.supersededByDocumentId ? (
          <div className="mt-3">
            <Alert variant="info">
              <Link
                href={`/projects/${projectId}/documents/${document.supersededByDocumentId}`}
                className="font-medium underline underline-offset-2"
              >
                {t('detail.supersededBy', {
                  number: document.supersededByDocumentNumber ?? '—',
                })}
              </Link>
            </Alert>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <RecordPanel title={t('detail.detailsTitle')} className="lg:col-span-1">
          <DefinitionList>
            <DefinitionRow label={t('col.category')}>
              {t(`category.${document.category}`)}
            </DefinitionRow>
            <DefinitionRow label={t('col.discipline')} emptyText="—">
              {document.discipline ? t(`discipline.${document.discipline}`) : undefined}
            </DefinitionRow>
            <DefinitionRow label={t('form.responsible')}>
              <PersonCell name={document.responsibleUserName} />
            </DefinitionRow>
            <DefinitionRow label={t('form.issuer')} emptyText="—">
              {document.issuerName ?? undefined}
            </DefinitionRow>
            <DefinitionRow label={t('form.issuedAt')}>
              <DateCell value={document.issuedAt} />
            </DefinitionRow>
            <DefinitionRow label={t('form.validFrom')}>
              <DateCell value={document.validFrom} />
            </DefinitionRow>
            <DefinitionRow label={t('form.expiresAt')}>
              <DateCell value={document.expiresAt} />
            </DefinitionRow>
            <DefinitionRow label={t('detail.revisionsCount', { count: revisions.length })}>
              {' '}
            </DefinitionRow>
          </DefinitionList>
        </RecordPanel>

        <div className="space-y-6 lg:col-span-2">
          <RecordPanel title={t('revision.currentTitle')}>
            {current ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-h2 font-bold text-foreground">
                    {current.revisionCode ??
                      t('revision.number', { number: current.revisionNumber })}
                  </span>
                  <RevisionStatusChip status={current.status} />
                  {current.purpose ? (
                    <Badge tone="accent">{t(`purpose.${current.purpose}`)}</Badge>
                  ) : null}
                </div>
                <p className="text-body-sm text-muted-foreground">
                  {current.issuedAt
                    ? `${t('revision.issuedOn', { date: formatDate(current.issuedAt, locale) ?? '—' })}${
                        current.issuedByName
                          ? ` ${t('revision.issuedBy', { name: current.issuedByName })}`
                          : ''
                      }`
                    : t('revisionStatus.DRAFT')}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" onClick={() => void openFile(current.file.id)}>
                    <Download size={16} strokeWidth={1.9} aria-hidden="true" />
                    {t('actions.download')}
                  </Button>
                  <span className="text-body-sm text-muted-foreground">
                    {current.file.originalName} · {formatBytes(current.file.sizeBytes)}
                  </span>
                </div>
                {current.file.lifecycle === 'IMMUTABLE' ? (
                  <p className="text-body-sm text-muted-foreground">{t('revision.immutableNote')}</p>
                ) : null}
                {current.notes ? (
                  <p className="text-body-sm text-foreground">{current.notes}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-body-sm text-warning">{t('revision.noCurrent')}</p>
            )}
          </RecordPanel>

          <RecordPanel title={t('revision.historyTitle')} padded={false}>
            <TableScroll>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col.revision')}</TableHead>
                    <TableHead>{t('col.status')}</TableHead>
                    <TableHead>{t('col.issued')}</TableHead>
                    <TableHead>{t('col.file')}</TableHead>
                    <TableHead>{t('col.createdBy')}</TableHead>
                    <TableHead>{t('col.superseded')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revisions.map((revision) => (
                    <RevisionRow
                      key={revision.id}
                      revision={revision}
                      onOpen={() => void openFile(revision.file.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          </RecordPanel>

          <RecordPanel title={t('detail.activityTitle')}>
            {activity.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">{t('detail.noActivity')}</p>
            ) : (
              <ol className="space-y-3">
                {activity.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-body-sm font-medium text-foreground">
                      {entry.sourceCommand.replace('projectDocument.', '')}
                    </span>
                    <span className="text-body-sm text-muted-foreground">
                      {entry.actorName ?? entry.actorUserId}
                    </span>
                    <span className="text-body-sm tabular-nums text-muted-foreground">
                      {formatDate(entry.occurredAt, locale) ?? '—'}
                    </span>
                    {entry.reason ? (
                      <span className="w-full text-body-sm text-muted-foreground">
                        {entry.reason}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </RecordPanel>
        </div>
      </div>

      <DocumentActionDialogs
        projectId={projectId}
        detail={query.data as ProjectDocumentDetailResponse}
        action={action}
        onClose={() => setAction(null)}
      />
    </div>
  );
}

function RevisionRow({
  revision,
  onOpen,
}: {
  revision: DocumentRevisionResponse;
  onOpen: () => void;
}) {
  const t = useTranslations('documents');
  return (
    <TableRow className={cn(revision.isCurrent && 'bg-brand-accent/40')}>
      <TableCell className="whitespace-nowrap font-medium">
        <span className="tabular-nums">
          {revision.revisionCode ?? t('revision.number', { number: revision.revisionNumber })}
        </span>
        {revision.isCurrent ? (
          <span className="ms-2 text-micro font-semibold uppercase tracking-[0.06em] text-brand-primary">
            {t('revision.current')}
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <RevisionStatusChip status={revision.status} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <DateCell value={revision.issuedAt} />
      </TableCell>
      <TableCell className="max-w-[14rem]">
        {/* Historical revisions stay openable. That is the point of keeping them — the file
            authorization service gates the bytes by project membership either way. */}
        <button
          type="button"
          onClick={onOpen}
          className="min-h-11 truncate text-start text-body-sm text-brand-primary underline underline-offset-2"
        >
          {revision.file.originalName}
        </button>
      </TableCell>
      <TableCell className="max-w-[10rem]">
        <PersonCell name={revision.createdByName} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <DateCell value={revision.supersededAt} />
      </TableCell>
    </TableRow>
  );
}
