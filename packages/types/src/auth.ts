export interface JwtPayload {
  sub: string;
  email: string;
  orgId: string;
  tenantSlug: string;
  roles: string[];
  permissions: string[];
  lang: 'en' | 'ar';
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
