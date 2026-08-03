import type { CreateProjectPayload } from './api/projects-api';

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
