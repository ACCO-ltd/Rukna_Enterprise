export interface JwtPayload {
  sub: string;
  email: string;
  /**
   * Display name ("Amina Yusuf"), for addressing the person in the UI.
   *
   * Optional because a token minted before this claim existed is still valid until it
   * refreshes, and the client must render something sensible in the meantime — it falls back
   * to the email. It is display data, never an authorization input.
   */
  name?: string;
  orgId: string;
  tenantSlug: string;
  roles: string[];
  permissions: string[];
  mustChangePassword?: boolean;
  sessionVersion?: number;
  jti?: string;
  iat?: number;
  exp?: number;
}

// Login and refresh both return only the access token in the response body.
// The refresh token is set as an HttpOnly cookie by the API (Path=/api/v1/auth).
export interface LoginResponse {
  accessToken: string;
}

// Kept for backward compatibility during the Sprint 2 frontend migration.
export type TokenPair = LoginResponse;

// Attached to request.user by JwtAuthGuard after token + org-membership validation.
export interface RequestIdentity {
  userId: string;
  activeOrganizationId: string;
  tenantSlug: string;
  roles: string[];
  permissions: string[];
  mustChangePassword?: boolean;
}
