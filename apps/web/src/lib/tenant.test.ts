import { describe, expect, it } from 'vitest';

import { buildApiBaseUrl, resolveTenantSlug } from './tenant';

const env = {
  template: 'http://{slug}.localhost:3001/api/v1',
  fallback: 'http://acco.localhost:3001/api/v1',
};

describe('resolveTenantSlug', () => {
  it('extracts the subdomain from a tenant host', () => {
    expect(resolveTenantSlug('acco.localhost')).toBe('acco');
    expect(resolveTenantSlug('acco.rukna.app')).toBe('acco');
  });

  it('ignores the port', () => {
    expect(resolveTenantSlug('acco.localhost:3000')).toBe('acco');
  });

  it('is case-insensitive', () => {
    expect(resolveTenantSlug('ACCO.localhost')).toBe('acco');
  });

  // Mirrors TenancyMiddleware.extractSlug in the API — if these diverge, the frontend
  // builds URLs the API answers with 404 Tenant not found.
  it('returns null for hosts that carry no tenant', () => {
    expect(resolveTenantSlug('localhost')).toBeNull();
    expect(resolveTenantSlug('www.rukna.app')).toBeNull();
    expect(resolveTenantSlug('api.rukna.app')).toBeNull();
    expect(resolveTenantSlug('')).toBeNull();
  });
});

describe('buildApiBaseUrl', () => {
  it('substitutes the slug into the template', () => {
    expect(buildApiBaseUrl('acco.localhost:3000', env)).toBe('http://acco.localhost:3001/api/v1');
    expect(buildApiBaseUrl('demo.rukna.app', env)).toBe('http://demo.localhost:3001/api/v1');
  });

  it('falls back when the host carries no tenant', () => {
    expect(buildApiBaseUrl('localhost:3000', env)).toBe(env.fallback);
  });

  it('falls back when there is no host at all (server-side rendering)', () => {
    expect(buildApiBaseUrl(null, env)).toBe(env.fallback);
  });

  it('strips a trailing slash so endpoint concatenation stays correct', () => {
    expect(buildApiBaseUrl('acco.localhost', { template: 'http://{slug}.test/api/v1/' })).toBe(
      'http://acco.test/api/v1',
    );
  });

  it('throws an actionable error when neither variable is configured', () => {
    expect(() => buildApiBaseUrl('acco.localhost', {})).toThrow(
      /NEXT_PUBLIC_API_URL_TEMPLATE/,
    );
  });
});
