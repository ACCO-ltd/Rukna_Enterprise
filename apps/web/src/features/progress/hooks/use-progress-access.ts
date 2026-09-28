'use client';

import { usePermissions } from '@/features/auth/permissions/can';

import type { ProgressAccess } from '../domain/progress-views';
import { PROGRESS_PERMISSIONS } from '../permissions';

/**
 * The reader's Progress permissions, resolved once. Pair with `canSeeProgressView` so the shell,
 * the landing redirect and every in-view link agree on which views a reader can open.
 */
export function useProgressAccess(): ProgressAccess {
  const { can } = usePermissions();
  return {
    canRecord: can(PROGRESS_PERMISSIONS.record),
    canApprove: can(PROGRESS_PERMISSIONS.approve),
    canManage: can(PROGRESS_PERMISSIONS.manage),
  };
}
