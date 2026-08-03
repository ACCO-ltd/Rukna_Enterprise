import { describe, expect, it } from 'vitest';

import {
  EMPTY_PROJECT_FORM,
  toCreateProjectPayload,
  type ProjectFormValues,
} from './project-form-payload';

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
