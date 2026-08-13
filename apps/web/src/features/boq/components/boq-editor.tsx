'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';
import { Plus } from '@phosphor-icons/react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';

import { useAddNode, useDeleteNode, useReorderNode, useUpdateNode } from '../hooks/use-boq';
import { nextSortOrder, planReorder } from '../node-actions';
import {
  toCreateNodePayload,
  toUpdateNodePayload,
  type NodeFormValues,
  type NodeKind,
} from '../node-form';
import type { BoqTreeNode } from '../types';
import { BoqNodeDialog } from './boq-node-dialog';
import { BoqTree } from './boq-tree';
import type { NodeRowCommands } from './boq-tree-row';

interface BoqEditorProps {
  projectId: string;
  versionId: string;
  nodes: BoqTreeNode[];
  /** Written onto priced rows; null when the project has no contract currency. */
  projectCurrency: string | null;
}

type Dialog =
  | { mode: 'add'; kind: NodeKind; parent: BoqTreeNode | null }
  | { mode: 'edit'; node: BoqTreeNode }
  | { mode: 'delete'; node: BoqTreeNode };

export function BoqEditor({ projectId, versionId, nodes, projectCurrency }: BoqEditorProps) {
  const t = useTranslations('platform.boq.nodes');
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const addNode = useAddNode(projectId, versionId);
  const updateNode = useUpdateNode(projectId, versionId);
  const deleteNode = useDeleteNode(projectId, versionId);
  const reorder = useReorderNode(projectId, versionId);

  const close = () => {
    addNode.reset();
    updateNode.reset();
    deleteNode.reset();
    setDialog(null);
  };

  const commands: NodeRowCommands = {
    onAddChild: (parent, kind) => {
      setDialog({ mode: 'add', kind, parent });
    },
    onEdit: (node) => {
      setDialog({ mode: 'edit', node });
    },
    onDelete: (node) => {
      setDialog({ mode: 'delete', node });
    },
    onReorder: (node, direction) => {
      const siblings = findSiblings(nodes, node);
      const plan = planReorder(node, siblings, direction);
      if (!plan) return;

      reorder.mutate({ ...plan, parentId: node.parentId });
    },
  };

  const submitForm = (values: NodeFormValues) => {
    if (dialog?.mode === 'add') {
      const siblings = dialog.parent ? dialog.parent.children : nodes;

      addNode.mutate(
        toCreateNodePayload(values, {
          kind: dialog.kind,
          // The server requires a position and never allocates one — append to the end.
          sortOrder: nextSortOrder(siblings),
          parentId: dialog.parent?.id,
          projectCurrency,
        }),
        { onSuccess: () => { setDialog(null); } },
      );
      return;
    }

    if (dialog?.mode === 'edit') {
      updateNode.mutate(
        {
          nodeId: dialog.node.id,
          payload: toUpdateNodePayload(values, {
            kind: dialog.node.isLeaf ? 'item' : 'section',
            projectCurrency,
          }),
        },
        { onSuccess: () => { setDialog(null); } },
      );
    }
  };

  const formPending = dialog?.mode === 'add' ? addNode.isPending : updateNode.isPending;
  const formError =
    dialog?.mode === 'add'
      ? errorText(addNode.error, addNode.isError, t('saveFailed'))
      : errorText(updateNode.error, updateNode.isError, t('saveFailed'));

  return (
    <div className="space-y-3">
      {reorder.isError ? (
        <Alert variant="error" messages={[errorText(reorder.error, true, t('reorderFailed'))!]} />
      ) : null}

      <div className="flex justify-end rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-control)]">
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => {
            setDialog({ mode: 'add', kind: 'section', parent: null });
          }}
        >
          <Plus size={16} aria-hidden="true" />
          {t('addSection')}
        </Button>
      </div>

      <BoqTree nodes={nodes} commands={commands} />

      {dialog?.mode === 'add' || dialog?.mode === 'edit' ? (
        <BoqNodeDialog
          kind={dialog.mode === 'add' ? dialog.kind : dialog.node.isLeaf ? 'item' : 'section'}
          node={dialog.mode === 'edit' ? dialog.node : undefined}
          projectCurrency={projectCurrency}
          isPending={formPending}
          errorMessage={formError}
          onSubmit={submitForm}
          onDismiss={close}
        />
      ) : null}

      {dialog?.mode === 'delete' ? (
        <ConfirmActionDialog
          title={t('deleteTitle')}
          description={`${dialog.node.code} — ${dialog.node.description}. ${t('deleteDescription')}`}
          confirmLabel={t('deleteConfirm')}
          isPending={deleteNode.isPending}
          errorMessage={errorText(deleteNode.error, deleteNode.isError, t('deleteFailed'))}
          onConfirm={() => {
            deleteNode.mutate(dialog.node.id, { onSuccess: () => { setDialog(null); } });
          }}
          onDismiss={close}
        />
      ) : null}
    </div>
  );
}

/** The list a node belongs to: its parent's children, or the roots. */
function findSiblings(roots: BoqTreeNode[], node: BoqTreeNode): BoqTreeNode[] {
  if (node.parentId === null) return roots;

  const walk = (candidates: BoqTreeNode[]): BoqTreeNode[] | null => {
    for (const candidate of candidates) {
      if (candidate.id === node.parentId) return candidate.children;
      const found = walk(candidate.children);
      if (found) return found;
    }
    return null;
  };

  return walk(roots) ?? [];
}

/** Prefers the server's explanation — it names the rule that was broken. */
function errorText(error: unknown, isError: boolean, fallback: string): string | undefined {
  if (!isError) return undefined;
  if (error instanceof ApiError && error.messages.length > 0) return error.messages.join(' ');
  return fallback;
}
