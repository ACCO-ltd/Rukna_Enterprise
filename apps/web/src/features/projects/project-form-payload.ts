import type { CreateProjectPayload, UpdateProjectPayload } from './api/projects-api';
import type { Project } from './types';

/** What the form holds — every field a string, as HTML inputs produce. */
export interface ProjectFormValues {
  code: string;
  name: string;
  /** Legacy fixture compatibility; Arabic business names are no longer captured. */
  nameAr?: string;
  description: string;
  clientName: string;
  clientId: string;
  commercialModel: 'CLIENT_CONTRACT' | 'INTERNAL_CAPITAL';
  participationModel: 'SOLE' | 'JOINT_VENTURE';
  location: string;
  contractValue: string;
  currency: string;
  startDate: string;
  expectedEndDate: string;
}

export const EMPTY_PROJECT_FORM: ProjectFormValues = {
  code: '',
  name: '',
  description: '',
  clientName: '',
  clientId: '',
  commercialModel: 'CLIENT_CONTRACT',
  participationModel: 'SOLE',
  location: '',
  contractValue: '',
  currency: '',
  startDate: '',
  expectedEndDate: '',
};

/**
 * Converts form values into the request body.
 *
 * Empty optional fields are OMITTED rather than sent as `""`. Two reasons:
 *
 *  1. The API validates with `forbidNonWhitelisted: true` and `@Length(3, 3)` on
 *     `currency` — an empty string is not "absent", it is an invalid three-character code,
 *     and the request fails with a 400 that is confusing to the user.
 *  2. An empty string stored in a nullable column is not the same as NULL. "The client
 *     name is blank" and "the client name is unknown" are different facts, and financial
 *     records should not blur them.
 *
 * Commercial value and currency intentionally do not travel through this workflow. The
 * main Contract owns those values; legacy Project columns remain read-compatible only.
 */
export function toCreateProjectPayload(values: ProjectFormValues): CreateProjectPayload {
  const payload: CreateProjectPayload = {
    name: values.name.trim(),
    commercialModel: values.commercialModel,
    participationModel: values.participationModel,
  };

  const optionalText = {
    description: values.description,
    clientId: values.commercialModel === 'CLIENT_CONTRACT' ? values.clientId : '',
    location: values.location,
    startDate: values.startDate,
    expectedEndDate: values.expectedEndDate,
  } as const;

  for (const [key, value] of Object.entries(optionalText)) {
    const trimmed = value.trim();
    if (trimmed) {
      payload[key as keyof typeof optionalText] = trimmed;
    }
  }

  return payload;
}

/**
 * Converts form values into a PATCH body.
 *
 * Differs from create in one important way: an emptied optional field is sent as `null`,
 * not omitted. On a PATCH, omitting means "leave unchanged", so omission would make it
 * impossible to ever clear a description or location once set — the field would
 * be write-once, which is not what "edit" means to the user.
 *
 * `null` is safe to send: every optional column is nullable, `@IsOptional()` skips
 * validation for null, and Prisma writes NULL for it (whereas `undefined` skips the
 * column). `code` is absent entirely because it is immutable after creation.
 */
export function toUpdateProjectPayload(values: ProjectFormValues): UpdateProjectPayload {
  const text = (value: string): string | null => value.trim() || null;

  return {
    name: values.name.trim(),
    description: text(values.description),
    clientId: text(values.clientId),
    location: text(values.location),
    startDate: text(values.startDate),
    expectedEndDate: text(values.expectedEndDate),
  };
}

/** Fills the form from an existing project, converting nulls to the empty strings inputs need. */
export function toFormValues(project: Project): ProjectFormValues {
  return {
    code: project.code,
    name: project.name,
    description: project.description ?? '',
    clientName: project.clientName ?? '',
    clientId: project.clientId ?? '',
    commercialModel: project.commercialModel ?? 'CLIENT_CONTRACT',
    participationModel: project.participationModel ?? 'SOLE',
    location: project.location ?? '',
    contractValue: project.contractValue ?? '',
    currency: project.currency ?? '',
    // Date inputs need `YYYY-MM-DD`; the API sends a full ISO timestamp.
    startDate: toDateInputValue(project.startDate),
    expectedEndDate: toDateInputValue(project.expectedEndDate),
  };
}

function toDateInputValue(value: string | null): string {
  return value ? (value.split('T')[0] ?? '') : '';
}
