/**
 * Next.js middleware — refreshes Supabase auth cookies on every request and
 * gates the private app surface behind auth + completed onboarding.
 *
 * Protected routes: /my, /inbox, /create, /settings
 * (and everything else the matcher catches, except for the public pages
 * explicitly excluded in `config.matcher`).
 *
 * Follows the @supabase/ssr middleware pattern:
 * https://supabase.com/docs/guides/auth/server-side/nextjs
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const PROTECTED_PREFIXES = ['/my', '/inbox', '/create', '/settings'];

export async function middleware(request: NextRequest) {
  // Let everything through if Supabase isn't configured yet — avoids breaking
  // local dev before env is set up.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: '', ...options });
        response = NextResponse.next({ request });
        response.cookies.set({ name, value: '', ...options });
      },
    },
  });

  // Refresh the session cookie. Required per @supabase/ssr docs.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!isProtected) return response;

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Session is valid — check if the user has completed onboarding (has a
  // profile row). /onboarding itself is not in PROTECTED_PREFIXES so it's
  // reachable without infinite-looping.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Exclude Next internals, static assets, and our public routes/APIs. The
  // auth/siwe API routes do their own auth check (401); middleware shouldn't
  // redirect them.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/siwe|api/auth|api/users|signup|login|profile|onboarding|$).*)',
  ],
};
