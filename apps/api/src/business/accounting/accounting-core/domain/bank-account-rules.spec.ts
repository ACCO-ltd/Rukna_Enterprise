import { bankAccountFieldsProblem } from './bank-account-rules';

describe('bankAccountFieldsProblem (BK-1)', () => {
  const ok = { accountName: 'Operating', bankName: 'Salaam Bank', accountNumber: '0012', currencyCode: 'USD' };

  it('accepts a USD account, in any letter case, and USD by default', () => {
    expect(bankAccountFieldsProblem(ok)).toBeNull();
    expect(bankAccountFieldsProblem({ ...ok, currencyCode: 'usd' })).toBeNull();
    expect(bankAccountFieldsProblem({ ...ok, currencyCode: undefined })).toBeNull();
  });

  it('refuses another currency', () => {
    expect(bankAccountFieldsProblem({ ...ok, currencyCode: 'EUR' })?.errorCode).toBe('CURRENCY_NOT_SUPPORTED');
  });

  it('refuses a blank name, bank or number', () => {
    expect(bankAccountFieldsProblem({ ...ok, accountName: '   ' })).toMatchObject({ errorCode: 'FIELD_REQUIRED', field: 'accountName' });
    expect(bankAccountFieldsProblem({ ...ok, bankName: '' })).toMatchObject({ field: 'bankName' });
    expect(bankAccountFieldsProblem({ ...ok, accountNumber: ' ' })).toMatchObject({ field: 'accountNumber' });
  });
});
