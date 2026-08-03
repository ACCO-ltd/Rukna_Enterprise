import type { ProjectStatus } from '@erp/types';

import { apiClient } from '@/lib/api-client';

import type { Project } from '../types';

/**
 * Body accepted by `POST /projects`, mirroring CreateProjectDto.
 *
 * The API's ValidationPipe runs with `forbidNonWhitelisted: true`, so an unrecognised
 * property is a 400 rather than being ignored. Optional fields must therefore be OMITTED
 * when empty, not sent as `""` or `null` — see `toCreateProjectPayload`.
 *
 * `contractValue` is a number here, not the string the API returns. That asymmetry is the
 * API's: it accepts `@IsNumber` on the way in and serializes a Decimal on the way out.
 */
export interface CreateProjectPayload {
  code: string;
  name: string;
  nameAr?: string;
  description?: string;
  clientName?: string;
  contractValue?: number;
  currency?: string;
  startDate?: string;
  expectedEndDate?: string;
}

export function listProjects(status?: ProjectStatus): Promise<Project[]> {
  return apiClient<Project[]>('/projects', {
    ...(status ? { params: { status } } : {}),
  });
}

export function createProject(payload: CreateProjectPayload): Promise<Project> {
  return apiClient<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
