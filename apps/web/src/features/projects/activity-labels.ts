import { useTranslations } from 'next-intl';
import type { ProjectActivityEventResponse } from '@erp/types';

/**
 * Display labels for project history events (`recentActivity` and `GET /projects/:id/activity`).
 *
 * The server sends a stable `command` (e.g. `contract.record-signed`, `boq.commit`) and the
 * `resourceType` it happened to. The catalog lives in `platform.projects.activity.events` as
 * nested keys, so `events.<command>` resolves directly. Anything the catalog does not know reads
 * as a resource-aware fallback ("Contract changed") — never a machine code.
 */

type ActivityEventLike = Pick<ProjectActivityEventResponse, 'action' | 'sourceCommand'> &
  Partial<Pick<ProjectActivityEventResponse, 'command' | 'resourceType'>>;

export type ActivityFallback =
  | 'project'
  | 'team'
  | 'contract'
  | 'variation'
  | 'document'
  | 'programme'
  | 'progress'
  | 'boq'
  | 'record';

/** Which "… changed" sentence a resource type falls back to. */
export function activityFallback(resourceType: string | undefined): ActivityFallback {
  // A response from before `resourceType` existed only ever carried Project rows.
  if (!resourceType || resourceType === 'Project') return 'project';
  if (resourceType === 'ProjectMember') return 'team';
  if (resourceType === 'VariationOrder') return 'variation';
  if (resourceType.startsWith('Contract')) return 'contract';
  if (resourceType.startsWith('ProjectDocument')) return 'document';
  if (resourceType.startsWith('Programme') || resourceType === 'WorkPackage') return 'programme';
  if (resourceType.startsWith('Progress')) return 'progress';
  if (resourceType === 'Boq') return 'boq';
  return 'record';
}

/** A command that can be a catalog path: `area.verb`, letters and hyphens only. */
const CATALOG_COMMAND = /^[A-Za-z]+\.[A-Za-z-]+$/;

/**
 * The catalog key for an event, or null when it can only take the fallback. A waiver is recorded
 * under the command it unblocked (`project.start`, action `WAIVE`), so it gets its own label.
 */
export function activityEventKey(event: ActivityEventLike): string | null {
  const command = event.command ?? event.sourceCommand ?? '';
  if (event.action === 'WAIVE' && command.startsWith('project.')) {
    return 'events.project.conditionWaived';
  }
  return CATALOG_COMMAND.test(command) ? `events.${command}` : null;
}

/** `(event) => label` in the reader's language. */
export function useActivityLabel(): (event: ActivityEventLike) => string {
  const t = useTranslations('platform.projects.activity');
  return (event) => {
    const key = activityEventKey(event);
    // Dynamic catalog path — guarded by `t.has`, so an unknown command never renders its key.
    if (key && t.has(key as never)) return t(key as never);
    return t(`fallback.${activityFallback(event.resourceType)}`);
  };
}
