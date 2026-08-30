import { UserStatus } from '@erp/types';
import type { UserWithRolesResponse } from '@erp/types';

export { UserStatus };
export type { UserWithRolesResponse };

/**
 * `GET /users` — list of org users scoped to the caller's organisation.
 *
 * Retained as the shape the projects member picker was written against. The admin Users
 * screen uses the richer `UserWithRolesResponse` (roles + membership status) directly.
 * `GET /users` now returns that superset, so an `OrgUser` is a structural subset of a row.
 */
export interface OrgUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  organizationId: string;
}
