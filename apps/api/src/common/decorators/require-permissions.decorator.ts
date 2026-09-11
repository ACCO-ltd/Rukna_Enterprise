import { SetMetadata } from '@nestjs/common';

import type { PermissionKey } from '@erp/types';

export const REQUIRED_PERMISSIONS_KEY = 'required_permissions';
export const REQUIRED_ANY_PERMISSION_KEY = 'required_any_permission';

/** All listed permissions are required (AND). */
export const RequirePermissions = (...permissions: PermissionKey[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * ANY of the listed permissions is sufficient (OR). Introduced for ADR-029 §8 A-1: a BOQ edit is
 * authorized by `edit-scope:boq` OR `edit-cost:boq` OR the backward-compatible `manage:boq` umbrella.
 * Independent of `RequirePermissions`; a handler may carry both (all AND perms plus one OR set).
 */
export const RequireAnyPermission = (...permissions: PermissionKey[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ANY_PERMISSION_KEY, permissions);
