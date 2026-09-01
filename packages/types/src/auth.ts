export interface JwtPayload {
  sub: string;
  email: string;
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
