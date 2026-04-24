/**
 * Next.js middleware — refreshes Supabase auth cookies on protected requests,
 * redirects the legacy /signup route to /login, and treats onboarding as
 * complete only once `profiles.username` is populated.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const PROTECTED_PREFIXES = [
  '/my',
  '/create',
  '/inbox',
  '/c',
  '/settings',
  '/profile',
  '/onboarding',
  '/degen',
];

function matchesProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
  // Let everything through if Supabase isn't configured yet — avoids breaking
  // local dev before env is set up.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const { pathname, search } = request.nextUrl;

  if (pathname === '/signup' || pathname.startsWith('/signup/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (!matchesProtectedPath(pathname)) {
    return response;
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set({ name, value, ...options });
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Refresh the session cookie. Required per @supabase/ssr docs.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle();

  const hasUsername = Boolean(profile?.username);

  if (!hasUsername && pathname !== '/onboarding') {
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (hasUsername && pathname === '/onboarding') {
    const url = request.nextUrl.clone();
    url.pathname = '/my';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/signup',
    '/my/:path*',
    '/create/:path*',
    '/inbox/:path*',
    '/c/:path*',
    '/settings/:path*',
    '/profile/:path*',
    '/onboarding/:path*',
    '/degen/:path*',
  ],
};
