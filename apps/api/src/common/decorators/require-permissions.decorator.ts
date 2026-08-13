import { SetMetadata } from '@nestjs/common';

import type { PermissionKey } from '@erp/types';

export const REQUIRED_PERMISSIONS_KEY = 'required_permissions';

/** All listed permissions are required. */
export const RequirePermissions = (...permissions: PermissionKey[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
