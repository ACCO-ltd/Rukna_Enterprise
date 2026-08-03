/**
 * Tenant resolution.
 *
 * The API is tenant-scoped by subdomain — `http://{slug}.localhost:3001/api/v1` in
 * development, `https://{slug}.rukna.app/api/v1` in production. The slug is derived from
 * the browser host so that a single deployment serves every tenant.
 *
 * The rules here intentionally mirror `TenancyMiddleware.extractSlug` in the API
 * (apps/api/src/platform/tenancy/tenancy.middleware.ts). If the two disagree, the
 * frontend builds a URL the API answers with `404 Tenant not found`.
 */

const SLUG_TOKEN = '{slug}';
const RESERVED_SUBDOMAINS = new Set(['www', 'api']);

/**
 * Extracts the tenant slug from a hostname.
 * Returns null when the host carries no tenant (bare `localhost`, an IP, `www.`, `api.`).
 */
export function resolveTenantSlug(hostname: string): string | null {
  const host = hostname.split(':')[0]?.trim().toLowerCase() ?? '';
  if (!host) return null;

  const parts = host.split('.');
  if (parts.length < 2) return null;

  const subdomain = parts[0];
  if (!subdomain || RESERVED_SUBDOMAINS.has(subdomain)) return null;

  return subdomain;
}

/**
 * Builds the API base URL for a given host.
 *
 * Prefers the host-derived template. Falls back to NEXT_PUBLIC_API_URL when the host
 * carries no tenant — which covers server-side rendering, tests, and bare-localhost
 * development.
 */
export function buildApiBaseUrl(
  hostname: string | null,
  env: { template?: string | undefined; fallback?: string | undefined } = {
    template: process.env['NEXT_PUBLIC_API_URL_TEMPLATE'],
    fallback: process.env['NEXT_PUBLIC_API_URL'],
  },
): string {
  const slug = hostname ? resolveTenantSlug(hostname) : null;

  if (env.template && slug) {
    return stripTrailingSlash(env.template.replaceAll(SLUG_TOKEN, slug));
  }

  if (env.fallback) {
    return stripTrailingSlash(env.fallback);
  }

  throw new Error(
    'Cannot resolve the API base URL. Set NEXT_PUBLIC_API_URL_TEMPLATE (recommended) ' +
      'or NEXT_PUBLIC_API_URL in apps/web/.env.local.',
  );
}

/** Base URL for the tenant serving the current request. */
export function getApiBaseUrl(): string {
  const hostname = typeof window === 'undefined' ? null : window.location.hostname;
  return buildApiBaseUrl(hostname);
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
