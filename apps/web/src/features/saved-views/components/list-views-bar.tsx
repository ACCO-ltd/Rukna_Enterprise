'use client';

import { useState } from 'react';
import { Bookmark, Plus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
  OverflowGlyph,
  SavedViews,
  type SavedView,
} from '@erp/ui';
import type { SavedViewDto, SavedViewState } from '@erp/types';

import { usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';

import { useSavedViewMutations, useSavedViews } from '../hooks/use-saved-views';

/** A view the list ships with — "All", "Overdue", "Drafts" — with its live count. */
export interface BuiltInView {
  id: string;
  label: string;
  state: SavedViewState;
  count?: number;
}

export interface ListViewsBarProps {
  /** Stable key of the list, e.g. "invoices". Saved views are stored against it. */
  listKey: string;
  builtIns: BuiltInView[];
  /** The list's current search / filters / sort. */
  current: SavedViewState;
  /** Put a view's state into the list's controls. */
  onApply: (state: SavedViewState) => void;
  /** Count of rows a saved view's state would show — so saved views get counts too. */
  countFor?: (state: SavedViewState) => number | undefined;
  /** Accessible name of the tab strip, already translated. */
  label: string;
  /** id of the grid the views control. */
  controls?: string;
}

/** Same state ⇔ same search, the same non-empty filters and the same sort. */
export function sameViewState(a: SavedViewState, b: SavedViewState): boolean {
  const filters = (s: SavedViewState) =>
    JSON.stringify(
      Object.entries(s.filters ?? {})
        .filter(([, v]) => v !== '')
        .sort(([x], [y]) => x.localeCompare(y)),
    );
  const sort = (s: SavedViewState) => (s.sort ? `${s.sort.key}:${s.sort.direction}` : '');
  return (a.search ?? '').trim() === (b.search ?? '').trim() && filters(a) === filters(b) && sort(a) === sort(b);
}

/**
 * Step 2a (ADR-047): the views strip above a list. Built-in views first, then the views this user
 * saved and the ones an admin published to everyone (marked with a people icon). Picking a view
 * puts its search, filters and sort into the list. When the list no longer matches the picked
 * view, "Save view" (or "Save changes" on a view you may edit) appears.
 */
export function ListViewsBar({ listKey, builtIns, current, onApply, countFor, label, controls }: ListViewsBarProps) {
  const t = useTranslations('common.views');
  const { can } = usePermissions();
  const isAdmin = can('manage:organization');
  const saved = useSavedViews(listKey);
  const mutations = useSavedViewMutations(listKey);

  const [selectedId, setSelectedId] = useState<string>(builtIns[0]?.id ?? '');
  const [naming, setNaming] = useState<null | { mode: 'create' } | { mode: 'rename'; view: SavedViewDto }>(null);
  const [deleting, setDeleting] = useState<SavedViewDto | null>(null);

  const savedViews = saved.data ?? [];
  const selectedBuiltIn = builtIns.find((v) => v.id === selectedId);
  const selectedSaved = savedViews.find((v) => v.id === selectedId);
  const selectedState = selectedBuiltIn?.state ?? selectedSaved?.state;
  // A deleted or hidden view, or a list changed by hand, reads as "no view matches" — never as
  // a tab claiming to show something it does not.
  const matchesSelected = selectedState ? sameViewState(selectedState, current) : false;
  const activeId = matchesSelected ? selectedId : '';
  const canEdit = (view: SavedViewDto) => view.mine || (view.published && isAdmin);

  const tabs: SavedView[] = [
    ...builtIns.map((v) => ({ id: v.id, label: v.label, count: v.count })),
    ...savedViews.map((v) => ({
      id: v.id,
      label: v.published ? `${v.name} · ${t('shared')}` : v.name,
      count: countFor?.(v.state),
    })),
  ];

  const select = (id: string) => {
    const state = builtIns.find((v) => v.id === id)?.state ?? savedViews.find((v) => v.id === id)?.state;
    if (!state) return;
    setSelectedId(id);
    onApply(state);
  };

  const dirtyEditable = !matchesSelected && selectedSaved && canEdit(selectedSaved);

  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <SavedViews views={tabs} activeId={activeId} onSelect={select} label={label} controls={controls} />
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-border pb-1">
        {dirtyEditable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={mutations.update.isPending}
            onClick={() => mutations.update.mutate({ id: selectedSaved.id, state: current })}
          >
            {t('saveChanges')}
          </Button>
        ) : null}
        {!matchesSelected ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setNaming({ mode: 'create' })}>
            <Plus size={16} aria-hidden="true" /> {t('saveView')}
          </Button>
        ) : null}
        {selectedSaved && matchesSelected && (canEdit(selectedSaved) || isAdmin) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={t('manage', { name: selectedSaved.name })}>
                <OverflowGlyph />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit(selectedSaved) ? (
                <DropdownMenuItem onSelect={() => setNaming({ mode: 'rename', view: selectedSaved })}>
                  {t('rename')}
                </DropdownMenuItem>
              ) : null}
              {isAdmin ? (
                <DropdownMenuItem
                  onSelect={() =>
                    mutations.publish.mutate({ id: selectedSaved.id, published: !selectedSaved.published })
                  }
                >
                  {selectedSaved.published ? (
                    <>
                      <Bookmark size={16} aria-hidden="true" /> {t('makePersonal')}
                    </>
                  ) : (
                    <>
                      <Users size={16} aria-hidden="true" /> {t('shareWithEveryone')}
                    </>
                  )}
                </DropdownMenuItem>
              ) : null}
              {canEdit(selectedSaved) ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-danger" onSelect={() => setDeleting(selectedSaved)}>
                    {t('delete')}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {naming ? (
        <NameViewDialog
          initialName={naming.mode === 'rename' ? naming.view.name : ''}
          title={naming.mode === 'rename' ? t('renameTitle') : t('saveTitle')}
          hint={naming.mode === 'create' ? t('saveHint') : undefined}
          busy={mutations.create.isPending || mutations.update.isPending}
          onCancel={() => setNaming(null)}
          onSubmit={(name, onError) => {
            if (naming.mode === 'rename') {
              mutations.update.mutate(
                { id: naming.view.id, name },
                { onSuccess: () => setNaming(null), onError },
              );
            } else {
              mutations.create.mutate(
                { name, state: current },
                {
                  onSuccess: (view) => {
                    setSelectedId(view.id);
                    setNaming(null);
                  },
                  onError,
                },
              );
            }
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (!open ? setDeleting(null) : undefined)}
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        description={deleting?.published ? t('deleteSharedBody') : t('deleteBody')}
        confirmLabel={t('delete')}
        variant="destructive"
        isPending={mutations.remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          mutations.remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              if (builtIns[0]) select(builtIns[0].id);
            },
          });
        }}
      />
    </div>
  );
}

function NameViewDialog({
  initialName,
  title,
  hint,
  busy,
  onCancel,
  onSubmit,
}: {
  initialName: string;
  title: string;
  hint?: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string, onError: (error: unknown) => void) => void;
}) {
  const t = useTranslations('common.views');
  const tCommon = useTranslations('common');
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  return (
    <FormDialog
      open
      onOpenChange={(open) => (!open ? onCancel() : undefined)}
      title={title}
      size="md"
      busy={busy}
      dirty={name !== initialName}
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed === '') return;
        setError(null);
        onSubmit(trimmed, (err) => setError(err instanceof ApiError ? err.message : t('saveFailed')));
      }}
    >
      <FormDialogBody className="space-y-4">
        {error ? <Alert variant="error" messages={[error]} /> : null}
        <FormField htmlFor="saved-view-name" label={t('nameLabel')} hint={hint} required>
          <Input id="saved-view-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormField>
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={busy}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" disabled={trimmed === '' || busy}>
          {busy ? t('saving') : t('save')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
