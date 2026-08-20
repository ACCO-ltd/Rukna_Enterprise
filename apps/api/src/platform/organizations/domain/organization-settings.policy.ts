export const EDITABLE_ORGANIZATION_SETTINGS = [
  'legalName',
  'tradingName',
  'registrationNumber',
  'taxNumber',
  'address',
  'contactDetails',
  'logo',
  'timezone',
  'defaultLocale',
  'reportingCurrency',
  'fiscalYearStart',
  'defaultPaymentTerms',
  'numberingPrefixes',
] as const;

export type EditableOrganizationSetting = (typeof EDITABLE_ORGANIZATION_SETTINGS)[number];

export function isEditableOrganizationSetting(value: string): value is EditableOrganizationSetting {
  return (EDITABLE_ORGANIZATION_SETTINGS as readonly string[]).includes(value);
}

export function assertOrganizationSettingsPatch(patch: Record<string, unknown>): void {
  const forbidden = Object.keys(patch).filter((key) => !isEditableOrganizationSetting(key));
  if (forbidden.length > 0) {
    throw new Error(`ORGANIZATION_SETTING_NOT_EDITABLE:${forbidden.sort().join(',')}`);
  }
}
