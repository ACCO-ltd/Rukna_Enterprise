import { apiClient } from '@/lib/api-client';

import type { OrgRole } from '../types';

export async function listRoles(): Promise<OrgRole[]> {
  return apiClient<OrgRole[]>('/roles');
}
