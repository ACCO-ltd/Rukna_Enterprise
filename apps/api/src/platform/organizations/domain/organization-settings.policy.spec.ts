import {
  assertOrganizationSettingsPatch,
  EDITABLE_ORGANIZATION_SETTINGS,
} from './organization-settings.policy.js';

describe('organization settings policy', () => {
  it('never exposes base currency as editable', () => {
    expect(EDITABLE_ORGANIZATION_SETTINGS).not.toContain('baseCurrency');
    expect(() => assertOrganizationSettingsPatch({ baseCurrency: 'EUR' })).toThrow(
      'ORGANIZATION_SETTING_NOT_EDITABLE:baseCurrency',
    );
  });

  it('accepts the confirmed OS-01 settings', () => {
    expect(() => assertOrganizationSettingsPatch({ legalName: 'ACCO', timezone: 'Africa/Nairobi' }))
      .not.toThrow();
  });
});
