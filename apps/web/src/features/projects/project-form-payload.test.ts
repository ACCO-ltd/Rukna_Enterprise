import { describe, expect, it } from 'vitest';

import { EMPTY_PROJECT_FORM, toCreateProjectPayload, toUpdateProjectPayload } from './project-form-payload';

describe('project form payloads', () => {

  it('clears editable fields on update while keeping the code immutable', () => {
    const payload = toUpdateProjectPayload({ ...EMPTY_PROJECT_FORM, code: 'ACCO-1', name: 'Tower' });

    expect(payload).not.toHaveProperty('code');
    expect(payload).not.toHaveProperty('nameAr');
    expect(payload.location).toBeNull();
  });
});
