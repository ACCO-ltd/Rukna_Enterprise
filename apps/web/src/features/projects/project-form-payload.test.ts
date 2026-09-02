import { ProjectCategory } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { EMPTY_PROJECT_FORM, toCreateProjectPayload, toUpdateProjectPayload } from './project-form-payload';

describe('project form payloads', () => {

  it('clears editable fields on update while keeping the code immutable', () => {
    const payload = toUpdateProjectPayload({ ...EMPTY_PROJECT_FORM, code: 'ACCO-1', name: 'Tower' });

    expect(payload).not.toHaveProperty('code');
    expect(payload).not.toHaveProperty('nameAr');
    expect(payload.location).toBeNull();
  });

  // ── Project type (PTD1-PTD5) ──────────────────────────────────────────────────

  it('sends the required category on create and omits an empty subtype', () => {
    const payload = toCreateProjectPayload({
      ...EMPTY_PROJECT_FORM,
      name: 'Tower',
      districtId: 'd-wbr',
      category: ProjectCategory.COMMERCIAL,
      subtypeId: '',
    });

    expect(payload.category).toBe(ProjectCategory.COMMERCIAL);
    // An optional subtype left blank must be absent, not "".
    expect(payload).not.toHaveProperty('subtypeId');
  });

  it('includes the subtype on create when one is chosen', () => {
    const payload = toCreateProjectPayload({
      ...EMPTY_PROJECT_FORM,
      name: 'Tower',
      districtId: 'd-wbr',
      category: ProjectCategory.RESIDENTIAL,
      subtypeId: 's-villas',
    });

    expect(payload.subtypeId).toBe('s-villas');
  });

  it('on update sends the category when set and null-clears an empty subtype', () => {
    const payload = toUpdateProjectPayload({
      ...EMPTY_PROJECT_FORM,
      name: 'Tower',
      category: ProjectCategory.INDUSTRIAL,
      subtypeId: '',
    });

    expect(payload.category).toBe(ProjectCategory.INDUSTRIAL);
    // PATCH semantics: null clears the column, so an emptied subtype is sent as null.
    expect(payload.subtypeId).toBeNull();
  });
});
