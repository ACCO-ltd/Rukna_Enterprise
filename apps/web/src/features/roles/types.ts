/** `GET /roles` — list of roles for the caller's organisation. */
export interface OrgRole {
  id: string;
  name: string;
  description: string | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}
