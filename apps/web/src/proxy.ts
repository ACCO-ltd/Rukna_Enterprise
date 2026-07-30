import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest): NextResponse {
  const response = NextResponse.next();

  const lang = request.cookies.get('lang')?.value;
  if (!lang) {
    const acceptLang = request.headers.get('accept-language') ?? '';
    const resolved = acceptLang.toLowerCase().includes('ar') ? 'ar' : 'en';
    response.cookies.set('lang', resolved, { path: '/', sameSite: 'lax' });
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
