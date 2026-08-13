import { describe, expect, it } from 'vitest';

import { EMPTY_PROJECT_FORM, toCreateProjectPayload, toUpdateProjectPayload } from './project-form-payload';

describe('project form payloads', () => {
  it('sends identity and schedule fields without commercial or Arabic-name legacy fields', () => {
    const payload = toCreateProjectPayload({
      ...EMPTY_PROJECT_FORM,
      name: ' Tower ',
      clientId: 'client-1',
      startDate: '2026-09-01',
    });

    expect(payload).toEqual({
      name: 'Tower',
      commercialModel: 'CLIENT_CONTRACT',
      participationModel: 'SOLE',
      clientId: 'client-1',
      startDate: '2026-09-01',
    });
    expect(payload).not.toHaveProperty('contractValue');
    expect(payload).not.toHaveProperty('currency');
    expect(payload).not.toHaveProperty('nameAr');
    expect(payload).not.toHaveProperty('code');
  });

  it('clears editable fields on update while keeping the code immutable', () => {
    const payload = toUpdateProjectPayload({ ...EMPTY_PROJECT_FORM, code: 'ACCO-1', name: 'Tower' });

    expect(payload).not.toHaveProperty('code');
    expect(payload).not.toHaveProperty('nameAr');
    expect(payload.location).toBeNull();
  });
});
