import { NextResponse } from 'next/server';

export function middleware(request) {
  const username = process.env.CRM_ACCESS_USER;
  const password = process.env.CRM_ACCESS_PASSWORD;

  // Fail closed: the database API must never be exposed without access protection.
  if (!username || !password) {
    return new NextResponse('Escarlate ainda não foi configurado. Defina CRM_ACCESS_USER e CRM_ACCESS_PASSWORD no Vercel.', { status: 503 });
  }

  const authorization = request.headers.get('authorization') || '';
  const expected = 'Basic ' + btoa(username + ':' + password);
  if (authorization !== expected) {
    return new NextResponse('Autenticação necessária.', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Escarlate CRM", charset="UTF-8"' },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
