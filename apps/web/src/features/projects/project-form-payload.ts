import type { CreateProjectPayload, UpdateProjectPayload } from './api/projects-api';
import type { Project } from './types';

/** What the form holds — every field a string, as HTML inputs produce. */
export interface ProjectFormValues {
  code: string;
  name: string;
  nameAr: string;
  description: string;
  clientName: string;
  contractValue: string;
  currency: string;
  startDate: string;
  expectedEndDate: string;
}

export const EMPTY_PROJECT_FORM: ProjectFormValues = {
  code: '',
  name: '',
  nameAr: '',
  description: '',
  clientName: '',
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
 * `contractValue` is converted to a number because the DTO declares `@IsNumber`. This is
 * the one place the frontend turns a monetary value into a JS number, and it is a
 * transport conversion at the edge — not arithmetic. The value is never summed here.
 */
export function toCreateProjectPayload(values: ProjectFormValues): CreateProjectPayload {
  const payload: CreateProjectPayload = {
    code: values.code.trim(),
    name: values.name.trim(),
  };

  const optionalText = {
    nameAr: values.nameAr,
    description: values.description,
    clientName: values.clientName,
    currency: values.currency,
    startDate: values.startDate,
    expectedEndDate: values.expectedEndDate,
  } as const;

  for (const [key, value] of Object.entries(optionalText)) {
    const trimmed = value.trim();
    if (trimmed) {
      payload[key as keyof typeof optionalText] = trimmed;
    }
  }

  const contractValue = values.contractValue.trim();
  if (contractValue) {
    const parsed = Number(contractValue);
    if (Number.isFinite(parsed)) payload.contractValue = parsed;
  }

  return payload;
}

/**
 * Converts form values into a PATCH body.
 *
 * Differs from create in one important way: an emptied optional field is sent as `null`,
 * not omitted. On a PATCH, omitting means "leave unchanged", so omission would make it
 * impossible to ever clear a client name or a contract value once set — the field would
 * be write-once, which is not what "edit" means to the user.
 *
 * `null` is safe to send: every optional column is nullable, `@IsOptional()` skips
 * validation for null, and Prisma writes NULL for it (whereas `undefined` skips the
 * column). `code` is absent entirely because it is immutable after creation.
 */
export function toUpdateProjectPayload(values: ProjectFormValues): UpdateProjectPayload {
  const text = (value: string): string | null => value.trim() || null;

  const contractValue = values.contractValue.trim();
  const parsedValue = contractValue === '' ? null : Number(contractValue);

  return {
    name: values.name.trim(),
    nameAr: text(values.nameAr),
    description: text(values.description),
    clientName: text(values.clientName),
    contractValue: parsedValue !== null && Number.isFinite(parsedValue) ? parsedValue : null,
    currency: text(values.currency),
    startDate: text(values.startDate),
    expectedEndDate: text(values.expectedEndDate),
  };
}

/** Fills the form from an existing project, converting nulls to the empty strings inputs need. */
export function toFormValues(project: Project): ProjectFormValues {
  return {
    code: project.code,
    name: project.name,
    nameAr: project.nameAr ?? '',
    description: project.description ?? '',
    clientName: project.clientName ?? '',
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
