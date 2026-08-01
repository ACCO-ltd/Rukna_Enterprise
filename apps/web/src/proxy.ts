import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest): NextResponse {
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
