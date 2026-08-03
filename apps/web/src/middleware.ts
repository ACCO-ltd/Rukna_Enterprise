import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = ['/login'];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));
  const hasAuth = request.cookies.has('__auth');

  // Redirect already-authenticated users away from public routes (e.g. /login)
  if (isPublic && hasAuth) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Redirect unauthenticated users away from protected routes.
  //
  // `__auth` is a routing hint only — it avoids painting a protected route before the
  // redirect. It cannot be replaced by a check on the real refresh cookie: that cookie is
  // HttpOnly AND scoped to `Path=/api/v1/auth`, so the browser never sends it to a Next.js
  // route and middleware cannot see it. Widening it to `Path=/` is filed as a backend
  // request in docs/backend-requests/frontend-blockers.md.
  //
  // The authoritative check is AuthGate, which must complete a token refresh before any
  // protected subtree renders. A forged marker buys a loading splash, then a redirect.
  if (!isPublic && !hasAuth) {
    const loginUrl = new URL('/login', request.url);
    const search = request.nextUrl.search;
    loginUrl.searchParams.set('next', pathname + (search ?? ''));
    return NextResponse.redirect(loginUrl);
  }

  // Set default lang cookie for first-time visitors
  const response = NextResponse.next();
  const lang = request.cookies.get('lang')?.value;
  if (lang !== 'ar' && lang !== 'en') {
    response.cookies.set('lang', 'en', { path: '/', sameSite: 'lax' });
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
