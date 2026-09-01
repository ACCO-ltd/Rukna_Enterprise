import { apiClient } from '@/lib/api-client';

/**
 * A row from the permission catalogue (`GET /permissions`).
 *
 * The catalogue endpoint returns the parts; `key` (the `action:resource` string the rest of
 * the platform uses) is derived on the client via {@link permissionKey}, since only
 * `GET /roles/:id` returns it pre-joined.
 */
export interface PermissionCatalogueItem {
  id: string;
  action: string;
  resource: string;
  description: string | null;
  domain: string;
  riskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

/** The `action:resource` key for a catalogue item — the platform's permission identifier. */
export function permissionKey(item: Pick<PermissionCatalogueItem, 'action' | 'resource'>): string {
  return `${item.action}:${item.resource}`;
}

/** `GET /permissions` — the full permission catalogue for the picker. */
export async function listPermissions(): Promise<PermissionCatalogueItem[]> {
  return apiClient<PermissionCatalogueItem[]>('/permissions');
}
