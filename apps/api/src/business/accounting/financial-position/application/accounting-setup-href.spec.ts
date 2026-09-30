import { accountingSetupHref } from './project-finance-overview.service.js';

describe('accountingSetupHref (flow plan A7)', () => {
  it('sends an unopened period to the periods page', () => {
    expect(accountingSetupHref('NO_OPEN_PERIOD')).toBe('/finance/accounting/periods');
  });

  it('sends an empty chart to the one-step setup and a profile gap to the profiles screen (ADR-040)', () => {
    expect(accountingSetupHref('NO_CHART_OF_ACCOUNTS')).toBe('/finance/accounting/chart-of-accounts?setup=template');
    expect(accountingSetupHref('NO_POSTING_PROFILES')).toBe('/finance/accounting/posting-profiles');
  });

  it('sends every other account gap to the chart of accounts', () => {
    expect(accountingSetupHref('POSTING_ACCOUNT_NOT_CONFIGURED')).toBe('/finance/accounting/chart-of-accounts');
    expect(accountingSetupHref(undefined)).toBe('/finance/accounting/chart-of-accounts');
  });
});
