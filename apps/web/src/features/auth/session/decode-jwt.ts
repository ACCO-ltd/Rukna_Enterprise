import type { JwtPayload } from '@erp/types';

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;

    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');

    const decoded =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf-8');

    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}
