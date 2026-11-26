import { NextResponse, type NextRequest } from "next/server";

export const SESSION_COOKIE_NAME = "konnexy_session";

const PUBLIC_PAGE_PATHS = new Set<string>(["/login", "/onboarding", "/demo"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon.svg" ||
    pathname === "/konnexy-logo.jpg" ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_PAGE_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();

  if (!sessionToken) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          errorCode: "UNAUTHENTICATED_ACCESS",
          publicMessage: "Autenticação obrigatória para acessar este endpoint.",
        },
        { status: 401 }
      );
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
