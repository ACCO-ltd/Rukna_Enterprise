/**
 * Browser cookies owned by the auth module.
 *
 * IMPORTANT: `__auth` is a *routing hint*, not a security boundary. It exists only so
 * `middleware.ts` can redirect without first painting a protected route. It is readable
 * and forgeable by any script — the real gate is the API, which rejects every request
 * without a valid access token, and the AuthGate bootstrap, which must succeed before a
 * protected route renders.
 *
 * The real session credential is the `refreshToken` cookie set by the API. It is HttpOnly
 * and scoped to `Path=/api/v1/auth`, so it is invisible both to this file and to Next.js
 * middleware. See docs/backend-requests/frontend-blockers.md for the request to widen it.
 */

export const AUTH_MARKER_COOKIE = '__auth';
export const LANG_COOKIE = 'lang';

/** Matches the refresh token's 7-day lifetime, so the hint expires with the session. */
const MARKER_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function setAuthMarker(): void {
  writeCookie(AUTH_MARKER_COOKIE, '1', MARKER_MAX_AGE_SECONDS);
}

export function clearAuthMarker(): void {
  writeCookie(AUTH_MARKER_COOKIE, '', 0);
}

/**
 * Seeds the UI language from the user's stored preference (the JWT `lang` claim).
 *
 * Only applied at login, so a device-local switch made afterwards is not overwritten on
 * every token refresh. Persisting a switch back to the user record needs a backend
 * endpoint that does not exist yet (B9).
 */
export function setLangCookie(lang: 'en' | 'ar'): void {
  writeCookie(LANG_COOKIE, lang, MARKER_MAX_AGE_SECONDS);
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${value}; path=/; SameSite=Lax; Max-Age=${String(maxAgeSeconds)}`;
}
