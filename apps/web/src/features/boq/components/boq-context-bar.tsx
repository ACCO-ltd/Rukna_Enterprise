'use client';

import Link from 'next/link';
import { Ellipsis, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { BoqWorkspaceResponse } from '@erp/types';
import {
  Button,
  ContextBar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  StatusPill,
  type ContextBarMetric,
  type ContextBarNoteTone,
} from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';
import { statusTone } from '@/lib/status-registry';

import type { VersionActions } from '../version-actions';

export interface BoqStage {
  /** The operational version is an open draft the reader may edit. */
  editable: boolean;
  /** A main client contract is ACTIVE: the signing snapshot exists. */
  signed: boolean;
  /** Legacy life stage: the operational version itself was committed (value cells pinned). */
  committed: boolean;
}

/**
 * The BOQ's own bar: what it is, its state, its size, and the ONE next step.
 *
 * The next step follows the commercial lifecycle in this repository (ADR-032), not a BOQ-local
 * "baseline" — there is no user-facing baseline/commit any more; recording the signed contract
 * takes the immutable snapshot. So:
 *
 *  - before signing → **Create contract**, offered only to someone who may record a signed
 *    contract (`create:contract` + `approve:contract`, what `POST /contracts/record-signed` needs);
 *  - after signing (or on a legacy committed version) → **Add extra work**, the who-pays decision,
 *    offered only to someone who may edit the BOQ.
 *
 * When neither applies there is no button — never a disabled one — and the note says why.
 */
export function BoqContextBar({
  workspace,
  stage,
  counts,
  actions,
  canCreateContract,
  canImport,
  createContractHref,
  onShowUnpriced,
  onAddExtraWork,
  onImport,
  onExport,
  onHistory,
  onCompare,
  onRevise,
  onDiscard,
}: {
  workspace: BoqWorkspaceResponse;
  stage: BoqStage;
  counts: { sections: number; items: number; priced: number };
  actions: VersionActions;
  canCreateContract: boolean;
  canImport: boolean;
  createContractHref: string;
  onShowUnpriced: () => void;
  onAddExtraWork: () => void;
  onImport: () => void;
  onExport: () => void;
  onHistory: () => void;
  onCompare?: () => void;
  onRevise: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations('platform.boq.contextBar');
  const locale = useLocale() as 'en' | 'ar';
  const { capabilities } = workspace;
  const canViewCost = capabilities.canViewCost;
  const version = workspace.draft ?? workspace.approved ?? workspace.versions[0] ?? null;
  const unpriced = Math.max(0, counts.items - counts.priced);
  const total = workspace.draft?.totalAmount ?? workspace.approved?.totalAmount ?? null;
  const signedOn = stage.signed ? formatDate(workspace.contractBaseline?.createdAt, locale) : null;

  const metrics: ContextBarMetric[] = [
    ...(version ? [{ key: 'version', label: t('version'), value: version.versionNumber }] : []),
    {
      key: 'lines',
      label: t('lines'),
      value: t('linesValue', { sections: counts.sections, items: counts.items }),
    },
    ...(canViewCost && !stage.signed && !stage.committed
      ? [{ key: 'priced', label: t('priced'), value: t('pricedValue', { priced: counts.priced, items: counts.items }) }]
      : []),
    ...(canViewCost
      ? [{ key: 'total', label: t('total'), value: formatMoney(total, workspace.currency, locale) ?? '—' }]
      : []),
    ...(signedOn ? [{ key: 'signed', label: t('signed'), value: signedOn }] : []),
  ];

  const afterSigning = stage.signed || stage.committed;
  const primary = afterSigning ? (
    capabilities.canEdit ? (
      <Button size="sm" className="gap-1.5" onClick={onAddExtraWork}>
        <Plus size={15} aria-hidden="true" />
        {t('addExtraWork')}
      </Button>
    ) : null
  ) : canCreateContract ? (
    <Button asChild size="sm">
      <Link href={createContractHref}>{t('createContract')}</Link>
    </Button>
  ) : null;

  // One note line, the most useful one: what is hidden, what is missing, or what governs edits.
  let note: string | null = null;
  let noteTone: ContextBarNoteTone = 'neutral';
  let noteAction: React.ReactNode = null;
  if (!canViewCost) {
    note = t('moneyHidden');
    noteTone = 'restricted';
  } else if (!afterSigning && unpriced > 0) {
    note = t('unpricedNote', { count: unpriced });
    noteTone = 'attention';
    noteAction = (
      <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onShowUnpriced}>
        {t('showUnpriced')}
      </Button>
    );
  } else if (stage.committed) {
    note = t('committedNote');
  } else if (stage.signed) {
    note = t('signedNote');
  } else if (!primary) {
    note = t('contractOwnerNote');
  }

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={t('more')} title={t('more')}>
          <Ellipsis size={18} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canImport ? <DropdownMenuItem onSelect={onImport}>{t('import')}</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={onExport}>{t('export')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onHistory}>{t('history')}</DropdownMenuItem>
        {onCompare ? <DropdownMenuItem onSelect={onCompare}>{t('compare')}</DropdownMenuItem> : null}
        {actions.canCreateDraft ? (
          <DropdownMenuItem onSelect={onRevise}>{t('startRevision')}</DropdownMenuItem>
        ) : null}
        {actions.canCancelDraft && stage.editable && !stage.signed ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onDiscard}>
              {t('discardDraft')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <ContextBar
      headingId="boq-context-title"
      title={t('title')}
      status={
        version ? (
          <StatusPill tone={statusTone(version.status, 'boqVersion')}>
            {t(`status.${version.status}`)}
          </StatusPill>
        ) : null
      }
      metrics={metrics}
      primary={primary}
      menu={menu}
      note={note}
      noteTone={noteTone}
      noteAction={noteAction}
    />
  );
}
