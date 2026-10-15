import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isEmailAllowed, publicEnv } from "../env";

const PUBLIC_PATHS = ["/login", "/auth/confirm", "/auth/signout"];

/** Refreshes the session cookie and redirects unauthenticated (or non-allowlisted) users to /login. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = publicEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!claims && !isPublic) {
    const u = request.nextUrl.clone();
    u.pathname = "/login";
    u.searchParams.set("next", path);
    return NextResponse.redirect(u);
  }
  if (claims && !isEmailAllowed(claims.email as string | undefined) && !isPublic) {
    const u = request.nextUrl.clone();
    u.pathname = "/auth/signout";
    u.searchParams.set("reason", "not_allowed");
    return NextResponse.redirect(u);
  }
  if (claims && path === "/login") {
    const u = request.nextUrl.clone();
    u.pathname = "/events";
    u.search = "";
    return NextResponse.redirect(u);
  }
  return response;
}
