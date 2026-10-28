import { apiClient } from '@/lib/api-client';
import type { CreateSavedViewInput, SavedViewDto, UpdateSavedViewInput } from '@erp/types';

/** `GET /saved-views?listKey=` — the caller's views plus every published one. */
export function listSavedViews(listKey: string): Promise<SavedViewDto[]> {
  return apiClient<SavedViewDto[]>(`/saved-views?listKey=${encodeURIComponent(listKey)}`);
}

export function createSavedView(input: CreateSavedViewInput): Promise<SavedViewDto> {
  return apiClient<SavedViewDto>('/saved-views', { method: 'POST', body: JSON.stringify(input) });
}

export function updateSavedView(id: string, input: UpdateSavedViewInput): Promise<SavedViewDto> {
  return apiClient<SavedViewDto>(`/saved-views/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** Admin only (manage:organization). */
export function setSavedViewPublished(id: string, published: boolean): Promise<SavedViewDto> {
  return apiClient<SavedViewDto>(`/saved-views/${id}/${published ? 'publish' : 'unpublish'}`, { method: 'POST' });
}

export function deleteSavedView(id: string): Promise<void> {
  return apiClient<void>(`/saved-views/${id}`, { method: 'DELETE' });
}
