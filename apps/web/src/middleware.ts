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

  // Redirect unauthenticated users away from protected routes
  // Sprint 2: replace __auth indicator cookie with HttpOnly refresh token cookie check
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
