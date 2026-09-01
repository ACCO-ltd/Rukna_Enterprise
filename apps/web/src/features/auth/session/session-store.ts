import { decodeJwt } from './decode-jwt';

export interface AuthenticatedUser {
  id: string;
  email: string;
  orgId: string;
  tenantSlug: string;
  roles: string[];
  permissions: string[];
  mustChangePassword?: boolean;
}

export interface SessionState {
  accessToken: string | null;
  user: AuthenticatedUser | null;
  isAuthenticated: boolean;
}

const EMPTY: SessionState = {
  accessToken: null,
  user: null,
  isAuthenticated: false,
};

type Listener = () => void;

let state: SessionState = EMPTY;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((l) => {
    l();
  });
}

/**
 * In-memory session. Deliberately not persisted to localStorage or sessionStorage — an
 * access token in web storage is readable by any XSS payload. The cost of memory-only
 * storage is that a page reload drops the token, which is why AuthGate re-establishes the
 * session from the HttpOnly refresh cookie on mount.
 */
export const sessionStore = {
  getState(): SessionState {
    return state;
  },
  setSession(next: { accessToken: string; user: AuthenticatedUser }): void {
    state = { accessToken: next.accessToken, user: next.user, isAuthenticated: true };
    emit();
  },
  /**
   * Decodes an access token and installs it as the active session. Returns the decoded
   * user, or null if the token is malformed — in which case the session is left untouched
   * and the caller decides how to fail.
   *
   * The signature is NOT verified here; that is the API's job on every request. Decoding
   * only populates UI state (identity, language, roles).
   */
  setFromAccessToken(accessToken: string): AuthenticatedUser | null {
    const payload = decodeJwt(accessToken);
    if (!payload?.sub) return null;

    const user: AuthenticatedUser = {
      id: payload.sub,
      email: payload.email,
      orgId: payload.orgId,
      tenantSlug: payload.tenantSlug,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
      mustChangePassword: payload.mustChangePassword === true,
    };

    sessionStore.setSession({ accessToken, user });
    return user;
  },
  clearSession(): void {
    if (state === EMPTY) return;
    state = EMPTY;
    emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
