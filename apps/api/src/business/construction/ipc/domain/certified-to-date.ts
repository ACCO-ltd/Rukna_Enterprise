/**
 * ADR-046 §5 — a contract's certified-to-date figure.
 *
 * IPA and IPC quantities are cumulative to date (ADR-005 CONST-IPC-015), so each effective
 * certificate already contains every earlier one. The contract's certified-to-date is therefore the
 * effective certificate of its **latest** application — never the sum of all certificates, which
 * counted earlier work once per later certificate.
 */
export interface CumulativeCertificate {
  createdAt: Date;
  application: { applicationNumber: number | null };
}

/**
 * The effective certificate of the latest application: highest application number, then newest.
 * An application without a number (a draft numbered later) sorts first, i.e. oldest.
 */
export function latestCertificate<T extends CumulativeCertificate>(certificates: readonly T[]): T | null {
  let latest: T | null = null;
  for (const cert of certificates) {
    if (!latest || isLater(cert, latest)) latest = cert;
  }
  return latest;
}

function isLater(a: CumulativeCertificate, b: CumulativeCertificate): boolean {
  const an = a.application.applicationNumber ?? -1;
  const bn = b.application.applicationNumber ?? -1;
  if (an !== bn) return an > bn;
  return a.createdAt.getTime() > b.createdAt.getTime();
}
