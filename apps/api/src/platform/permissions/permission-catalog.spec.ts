import { PERMISSION_DEFINITIONS, PERMISSIONS } from '@erp/types';

describe('permission catalogue', () => {
  it('contains unique action:resource keys', () => {
    const keys = PERMISSION_DEFINITIONS.map((permission) => permission.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('contains a definition for every exported permission', () => {
    expect(PERMISSION_DEFINITIONS.map((permission) => permission.key).sort()).toEqual(
      Object.values(PERMISSIONS).sort(),
    );
  });

  it.each(PERMISSION_DEFINITIONS)('$key follows the action:resource convention', (permission) => {
    expect(permission.key).toMatch(/^[a-z]+(?:-[a-z]+)*:[a-z]+(?:-[a-z]+)*$/);
    expect(permission.action).toBeTruthy();
    expect(permission.resource).toBeTruthy();
    expect(permission.description).toBeTruthy();
  });
});
