import { ProjectStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_PROJECT_FORM,
  toCreateProjectPayload,
  toFormValues,
  toUpdateProjectPayload,
  type ProjectFormValues,
} from './project-form-payload';
import type { Project } from './types';

function form(overrides: Partial<ProjectFormValues> = {}): ProjectFormValues {
  return { ...EMPTY_PROJECT_FORM, code: 'ACCO-2026-001', name: 'Tower', ...overrides };
}

describe('toCreateProjectPayload', () => {
  it('sends only the required fields when nothing else is filled in', () => {
    expect(toCreateProjectPayload(form())).toEqual({
      code: 'ACCO-2026-001',
      name: 'Tower',
    });
  });

  /**
   * The API validates with `forbidNonWhitelisted: true` and `@Length(3, 3)` on currency.
   * An empty string is not "absent" — it is an invalid code, and sending it turns a valid
   * submission into a confusing 400.
   */
  it('omits empty optional fields rather than sending empty strings', () => {
    const payload = toCreateProjectPayload(form({ currency: '', clientName: '', nameAr: '' }));

    expect(payload).not.toHaveProperty('currency');
    expect(payload).not.toHaveProperty('clientName');
    expect(payload).not.toHaveProperty('nameAr');
  });

  it('omits fields that contain only whitespace', () => {
    expect(toCreateProjectPayload(form({ clientName: '   ' }))).not.toHaveProperty('clientName');
  });

  it('trims the values it does send', () => {
    const payload = toCreateProjectPayload(
      form({ code: '  ACCO-1  ', name: '  Tower  ', clientName: '  Baraka  ' }),
    );

    expect(payload.code).toBe('ACCO-1');
    expect(payload.name).toBe('Tower');
    expect(payload.clientName).toBe('Baraka');
  });

  // The DTO declares @IsNumber, while the API returns Decimals as strings.
  it('converts contract value to a number for the request', () => {
    const payload = toCreateProjectPayload(form({ contractValue: '4500000.00' }));

    expect(payload.contractValue).toBe(4500000);
    expect(typeof payload.contractValue).toBe('number');
  });

  it('omits an unparseable contract value instead of sending NaN', () => {
    expect(toCreateProjectPayload(form({ contractValue: 'abc' }))).not.toHaveProperty(
      'contractValue',
    );
  });

  it('keeps a zero contract value, which is meaningful', () => {
    expect(toCreateProjectPayload(form({ contractValue: '0' })).contractValue).toBe(0);
  });

  it('passes dates through as ISO date strings', () => {
    const payload = toCreateProjectPayload(
      form({ startDate: '2026-09-01', expectedEndDate: '2028-03-31' }),
    );

    expect(payload.startDate).toBe('2026-09-01');
    expect(payload.expectedEndDate).toBe('2028-03-31');
  });
});

describe('toUpdateProjectPayload', () => {
  it('never sends the code, which is immutable', () => {
    expect(toUpdateProjectPayload(form())).not.toHaveProperty('code');
  });

  /**
   * The opposite rule from create. On a PATCH, an omitted key means "leave unchanged", so
   * omitting an emptied field would make every optional field write-once — a client name
   * entered by mistake could never be removed.
   */
  it('sends null for cleared fields so they can actually be cleared', () => {
    const payload = toUpdateProjectPayload(form({ clientName: '', currency: '', nameAr: '' }));

    expect(payload.clientName).toBeNull();
    expect(payload.currency).toBeNull();
    expect(payload.nameAr).toBeNull();
  });

  it('sends null for a cleared contract value', () => {
    expect(toUpdateProjectPayload(form({ contractValue: '' })).contractValue).toBeNull();
  });

  it('sends the values that are present', () => {
    const payload = toUpdateProjectPayload(
      form({ name: 'Renamed', clientName: 'Baraka', contractValue: '250.50', currency: 'AED' }),
    );

    expect(payload.name).toBe('Renamed');
    expect(payload.clientName).toBe('Baraka');
    expect(payload.contractValue).toBe(250.5);
    expect(payload.currency).toBe('AED');
  });
});

describe('toFormValues', () => {
  const project: Project = {
    id: 'p1',
    organizationId: 'org-1',
    code: 'ACCO-2026-001',
    name: 'Tower',
    nameAr: 'برج',
    description: null,
    status: ProjectStatus.DRAFT,
    contractValue: '4500000.00',
    currency: 'USD',
    clientName: null,
    startDate: '2026-09-01T00:00:00.000Z',
    expectedEndDate: null,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('turns nulls into the empty strings inputs require', () => {
    const values = toFormValues(project);

    expect(values.clientName).toBe('');
    expect(values.description).toBe('');
    expect(values.expectedEndDate).toBe('');
  });

  // A date input needs YYYY-MM-DD; handing it a full ISO timestamp leaves the field blank.
  it('trims an ISO timestamp down to a date input value', () => {
    expect(toFormValues(project).startDate).toBe('2026-09-01');
  });

  it('keeps the contract value as the string the API sent', () => {
    expect(toFormValues(project).contractValue).toBe('4500000.00');
  });

  it('round-trips unchanged values back to the same payload', () => {
    const payload = toUpdateProjectPayload(toFormValues(project));

    expect(payload.name).toBe('Tower');
    expect(payload.nameAr).toBe('برج');
    expect(payload.contractValue).toBe(4500000);
    expect(payload.startDate).toBe('2026-09-01');
  });
});
