export interface AuthenticatedUser {
  id: string;
  email: string;
  orgId: string;
  tenantSlug: string;
  roles: string[];
  permissions: string[];
  lang: 'en' | 'ar';
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

export const sessionStore = {
  getState(): SessionState {
    return state;
  },
  setSession(next: { accessToken: string; user: AuthenticatedUser }): void {
    state = { accessToken: next.accessToken, user: next.user, isAuthenticated: true };
    emit();
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
