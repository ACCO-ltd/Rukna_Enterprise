import { UserStatus } from '@erp/types';

export { UserStatus };

/** `GET /users` — list of org users scoped to the caller's organisation. */
export interface OrgUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  organizationId: string;
}
