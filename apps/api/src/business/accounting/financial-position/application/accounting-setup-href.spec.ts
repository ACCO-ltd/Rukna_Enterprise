import { accountingSetupHref } from './project-finance-overview.service.js';

describe('accountingSetupHref (flow plan A7)', () => {
  it('sends an unopened period to the periods page', () => {
    expect(accountingSetupHref('NO_OPEN_PERIOD')).toBe('/finance/accounting/periods');
  });

  it('sends every account and profile gap to the chart of accounts', () => {
    expect(accountingSetupHref('POSTING_ACCOUNT_NOT_CONFIGURED')).toBe('/finance/accounting/chart-of-accounts');
    expect(accountingSetupHref(undefined)).toBe('/finance/accounting/chart-of-accounts');
  });
});
