import { apiClient } from '@/lib/api-client';

import type { OrgUser } from '../types';

export async function listUsers(): Promise<OrgUser[]> {
  return apiClient<OrgUser[]>('/users');
}
