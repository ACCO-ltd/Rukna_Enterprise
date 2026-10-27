import { latestCertificate } from './certified-to-date.js';

const cert = (id: string, applicationNumber: number | null, day: number) => ({
  id,
  application: { applicationNumber },
  createdAt: new Date(Date.UTC(2026, 0, day)),
});

describe('latestCertificate (ADR-046 §5)', () => {
  it('picks the certificate of the highest application number, whatever the list order', () => {
    expect(latestCertificate([cert('a3', 3, 1), cert('a1', 1, 5), cert('a2', 2, 9)])?.id).toBe('a3');
  });

  it('breaks a tie on application number by the newer certificate', () => {
    expect(latestCertificate([cert('old', 2, 1), cert('new', 2, 2)])?.id).toBe('new');
  });

  it('ranks an unnumbered application below any numbered one', () => {
    expect(latestCertificate([cert('draft', null, 30), cert('one', 1, 1)])?.id).toBe('one');
  });

  it('returns null when there is no effective certificate', () => {
    expect(latestCertificate([])).toBeNull();
  });
});
