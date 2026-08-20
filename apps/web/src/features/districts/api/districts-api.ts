import { apiClient } from '@/lib/api-client';
import type { DistrictResponse, CreateDistrictInput, UpdateDistrictInput } from '@erp/types';

export type District = DistrictResponse;

/** `GET /districts` — ordered by code. Pass activeOnly for the project-create picker. */
export function listDistricts(activeOnly = false): Promise<District[]> {
  return apiClient<District[]>('/districts', {
    ...(activeOnly ? { params: { activeOnly: 'true' } } : {}),
  });
}

/** `POST /districts` — requires manage:district. Code is immutable once created. */
export function createDistrict(payload: CreateDistrictInput): Promise<District> {
  return apiClient<District>('/districts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** `PATCH /districts/:id` — rename or (de)activate. The code cannot change. */
export function updateDistrict(id: string, payload: UpdateDistrictInput): Promise<District> {
  return apiClient<District>(`/districts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
