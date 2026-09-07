'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  DocumentCategory,
  DocumentDiscipline,
  DocumentValidity,
  ProjectDocumentStatus,
  type ProjectDocumentResponse,
} from '@erp/types';
import {
  Alert,
  Button,
  Input,
  Label,
  Select,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  cn,
} from '@erp/ui';
import { FileText, Plus, SlidersHorizontal } from 'lucide-react';

import { useProjectMembers } from '@/features/projects/hooks/use-project-members';

import { useDocumentCapabilities, useProjectDocuments } from '../hooks/use-documents';
import type { DocumentListFilters } from '../api/documents-api';
import {
  DateCell,
  DocumentIdentity,
  DocumentStatusChip,
  PersonCell,
  RevisionLabel,
  ValidityChip,
} from './document-primitives';
import { RegisterDocumentDialog } from './register-document-dialog';

const PAGE_SIZE = 25;

/**
 * The controlled document register.
 *
 * An enterprise register, not a file browser: a wide table with strong row hierarchy, compact
 * filters, restrained state chips. No tiles, no folder tree, no drop zone occupying half the
 * screen. The people using this are looking up which drawing revision the site is building from,
 * not browsing their own files.
 *
 * Three columns carry the three axes the model keeps separate — Status (where the record is),
 * Revision (which issue is current), Validity (whether it can be relied on). Collapsing them into
 * one chip is the single most tempting simplification here and it would destroy the register's
 * only reason to exist.
 */
export function DocumentRegisterView({ projectId }: { projectId: string }) {
  const t = useTranslations('documents');
  const [filters, setFilters] = useState<DocumentListFilters>({});
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  const query = useProjectDocuments(projectId, { ...filters, page, pageSize: PAGE_SIZE });
  const capabilities = useDocumentCapabilities(projectId);
  const { data: members = [] } = useProjectMembers(projectId);

  const hasFilters = useMemo(
    () => Object.values(filters).some((value) => value !== undefined && value !== ''),
    [filters],
  );

  function setFilter(key: keyof DocumentListFilters, value: string) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  }

  const summary = query.data?.summary;
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h2 font-bold text-foreground">{t('views.register')}</h2>
        </div>
        {capabilities.data?.canCreate ? (
          <Button onClick={() => setRegisterOpen(true)}>
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            {t('actions.register')}
          </Button>
        ) : null}
      </div>

      {/* The summary band. Server-derived, whole-project, and never recomputed from the page —
          a control figure that moves when someone types in a search box is not a control figure. */}
      {summary ? (
        <dl className="grid grid-cols-2 overflow-hidden rounded-panel border border-border bg-surface sm:grid-cols-4">
          <SummaryFigure
            label={t('summary.controlledDocuments')}
            value={summary.controlledDocuments}
          />
          <SummaryFigure label={t('summary.currentDrawings')} value={summary.currentDrawings} />
          <SummaryFigure
            label={t('summary.expiringSoon')}
            value={summary.expiringSoon}
            hint={t('summary.expiringSoonHint', { days: summary.expiringSoonDays })}
            tone={summary.expiringSoon > 0 ? 'warning' : undefined}
          />
          <SummaryFigure
            label={t('summary.expired')}
            value={summary.expired}
            tone={summary.expired > 0 ? 'danger' : undefined}
          />
        </dl>
      ) : null}

      {/* Filters collapse behind a toggle at 375px rather than stacking six controls above the
          table, which would push the register itself off the first screen. */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 sm:hidden">
          <Button variant="outline" onClick={() => setFiltersOpen((open) => !open)}>
            <SlidersHorizontal size={16} strokeWidth={1.9} aria-hidden="true" />
            {t('filters.toggle')}
          </Button>
          {hasFilters ? (
            <Button variant="ghost" onClick={() => { setFilters({}); setPage(1); }}>
              {t('filters.clear')}
            </Button>
          ) : null}
        </div>

        <div
          className={cn(
            'grid gap-3 sm:grid-cols-2 lg:grid-cols-5',
            filtersOpen ? 'grid' : 'hidden sm:grid',
          )}
        >
          <FilterField id="doc-search" label={t('filters.search')}>
            <Input
              id="doc-search"
              type="search"
              value={filters.search ?? ''}
              placeholder={t('filters.searchPlaceholder')}
              onChange={(event) => setFilter('search', event.target.value)}
            />
          </FilterField>

          <FilterField id="doc-category" label={t('filters.category')}>
            <Select
              id="doc-category"
              value={filters.category ?? ''}
              onChange={(value) => setFilter('category', value)}
            >
              <option value="">{t('filters.all')}</option>
              {Object.values(DocumentCategory).map((value) => (
                <option key={value} value={value}>
                  {t(`category.${value}`)}
                </option>
              ))}
            </Select>
          </FilterField>

          <FilterField id="doc-discipline" label={t('filters.discipline')}>
            <Select
              id="doc-discipline"
              value={filters.discipline ?? ''}
              onChange={(value) => setFilter('discipline', value)}
            >
              <option value="">{t('filters.all')}</option>
              {Object.values(DocumentDiscipline).map((value) => (
                <option key={value} value={value}>
                  {t(`discipline.${value}`)}
                </option>
              ))}
            </Select>
          </FilterField>

          <FilterField id="doc-status" label={t('filters.status')}>
            <Select
              id="doc-status"
              value={filters.status ?? ''}
              onChange={(value) => setFilter('status', value)}
            >
              <option value="">{t('filters.all')}</option>
              {Object.values(ProjectDocumentStatus).map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </Select>
          </FilterField>

          <FilterField id="doc-validity" label={t('filters.validity')}>
            <Select
              id="doc-validity"
              value={filters.validity ?? ''}
              onChange={(value) => setFilter('validity', value)}
            >
              <option value="">{t('filters.all')}</option>
              {Object.values(DocumentValidity).map((value) => (
                <option key={value} value={value}>
                  {t(`validity.${value}`)}
                </option>
              ))}
            </Select>
          </FilterField>

          <FilterField id="doc-responsible" label={t('filters.responsible')}>
            <Select
              id="doc-responsible"
              value={filters.responsibleUserId ?? ''}
              onChange={(value) => setFilter('responsibleUserId', value)}
            >
              <option value="">{t('filters.all')}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {`${member.user.firstName} ${member.user.lastName}`.trim()}
                </option>
              ))}
            </Select>
          </FilterField>

          {hasFilters ? (
            <div className="hidden items-end sm:flex">
              <Button variant="ghost" onClick={() => { setFilters({}); setPage(1); }}>
                {t('filters.clear')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {query.isPending ? (
        <SkeletonTable columns={9} rows={6} label={t('states.loading')} />
      ) : query.isError ? (
        <Alert variant="error" title={t('states.loadFailed')} messages={[t('states.loadFailedHint')]}>
          <div className="mt-3">
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('actions.retry')}
            </Button>
          </div>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyRegister
          filtered={hasFilters}
          canCreate={Boolean(capabilities.data?.canCreate)}
          onRegister={() => setRegisterOpen(true)}
        />
      ) : (
        <>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col.document')}</TableHead>
                  <TableHead>{t('col.category')}</TableHead>
                  <TableHead>{t('col.discipline')}</TableHead>
                  <TableHead>{t('col.revision')}</TableHead>
                  <TableHead>{t('col.status')}</TableHead>
                  <TableHead>{t('col.validity')}</TableHead>
                  <TableHead>{t('col.responsible')}</TableHead>
                  <TableHead>{t('col.issued')}</TableHead>
                  <TableHead>{t('col.updated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((document) => (
                  <DocumentRow key={document.id} projectId={projectId} document={document} />
                ))}
              </TableBody>
            </Table>
          </TableScroll>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body-sm text-muted-foreground">
              {t('filters.showing', { shown: items.length, total })}
            </p>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                 
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  {t('actions.previous')}
                </Button>
                <span className="text-body-sm tabular-nums text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                 
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  {t('actions.next')}
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}

      <RegisterDocumentDialog
        projectId={projectId}
        open={registerOpen}
        onOpenChange={setRegisterOpen}
      />
    </div>
  );
}

function SummaryFigure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'warning' | 'danger';
}) {
  return (
    <div className="min-w-0 border-b border-border px-4 py-3.5 last:border-b-0 sm:border-b-0 sm:not-last:border-e nth-2:border-b-0">
      <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 text-h2 font-bold tabular-nums',
          // Colour only when the figure means someone has something to do. A zero in the
          // expired column is good news and reads as an ordinary number.
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          !tone && 'text-foreground',
        )}
      >
        {value}
      </dd>
      {hint ? <p className="mt-0.5 text-micro text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function FilterField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="text-micro font-semibold uppercase tracking-[0.06em]">
        {label}
      </Label>
      {children}
    </div>
  );
}

function DocumentRow({
  projectId,
  document,
}: {
  projectId: string;
  document: ProjectDocumentResponse;
}) {
  const t = useTranslations('documents');
  const revision = document.currentRevision;

  return (
    <TableRow>
      <TableCell className="max-w-[22rem]">
        {/* The whole identity is the link. A separate "Open" action column would spend a column
            on something the row itself already affords.

            `min-h-11` and centred: two lines of text come to about 40px, which is under the 44px
            touch minimum. The browser gate caught this only once the register had real rows in
            it — an empty table has no links to measure. */}
        <Link
          href={`/projects/${projectId}/documents/${document.id}`}
          className="flex min-h-11 flex-col justify-center rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        >
          <DocumentIdentity document={document} />
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap">{t(`category.${document.category}`)}</TableCell>
      <TableCell className="whitespace-nowrap">
        {document.discipline ? (
          t(`discipline.${document.discipline}`)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {revision ? (
          <RevisionLabel
            revisionCode={revision.revisionCode}
            revisionNumber={revision.revisionNumber}
          />
        ) : (
          // A document with no current revision is a real state the register must surface, not
          // an empty cell someone has to interpret.
          <span className="text-body-sm text-warning">{t('revision.noCurrent')}</span>
        )}
      </TableCell>
      <TableCell>
        <DocumentStatusChip status={document.status} />
      </TableCell>
      <TableCell>
        <ValidityChip
          validity={document.validity}
          daysUntilExpiry={document.daysUntilExpiry}
        />
      </TableCell>
      <TableCell className="max-w-[10rem]">
        <PersonCell name={document.responsibleUserName} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <DateCell value={document.issuedAt} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <DateCell value={document.updatedAt} />
      </TableCell>
    </TableRow>
  );
}

/**
 * Two different empty states, because they mean two different things and call for two different
 * actions: an empty register needs a first document, a filtered-to-nothing register needs the
 * filter widened. Showing "Register document" to someone who has just over-filtered sends them
 * to create a duplicate of the one they were looking for.
 */
function EmptyRegister({
  filtered,
  canCreate,
  onRegister,
}: {
  filtered: boolean;
  canCreate: boolean;
  onRegister: () => void;
}) {
  const t = useTranslations('documents');
  return (
    <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
      <FileText
        size={24}
        strokeWidth={1.6}
        aria-hidden="true"
        className="mx-auto text-muted-foreground"
      />
      <p className="mt-3 text-body font-medium text-foreground">
        {filtered ? t('states.noMatchTitle') : t('states.emptyTitle')}
      </p>
      <p className="mx-auto mt-1 max-w-prose text-body-sm text-muted-foreground">
        {filtered ? t('states.noMatchHint') : t('states.emptyHint')}
      </p>
      {!filtered && canCreate ? (
        <Button className="mt-4" onClick={onRegister}>
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          {t('actions.register')}
        </Button>
      ) : null}
    </div>
  );
}
