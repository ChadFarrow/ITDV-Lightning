import { NextRequest, NextResponse } from 'next/server';
import { validateSession, ADMIN_COOKIE_NAME } from '@/lib/admin-auth';

/**
 * Fail-closed guard for the admin API.
 *
 * Every route under /api/admin requires a valid session **here**, before the
 * handler runs, so adding a new admin route cannot accidentally ship without
 * auth. Eight of them previously had no check at all — including a DELETE that
 * truncated the feeds table and a POST that wrote caller-supplied text into
 * app/page.tsx. Handlers still do their own check as defence in depth; this is
 * the layer that makes forgetting one harmless.
 *
 * Only the login endpoint is exempt, since that is where a session is obtained.
 */
const PUBLIC_ADMIN_ROUTES = ['/api/admin/simple-auth'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_ADMIN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return NextResponse.next();
  }

  const authenticated = await validateSession(request.cookies.get(ADMIN_COOKIE_NAME)?.value);
  if (!authenticated) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/admin/:path*'],
};
