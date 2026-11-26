/**
 * Official Auth.js v5 session cookie names (HTTP localhost vs HTTPS production).
 * Kept in a pure module with zero Next.js runtime imports so both server runtime
 * and unit tests can share the exact same cookie/salt resolution logic.
 */
export const AUTHJS_SESSION_COOKIE_NAME = "authjs.session-token";
export const SECURE_AUTHJS_SESSION_COOKIE_NAME = `__Secure-${AUTHJS_SESSION_COOKIE_NAME}`;
export const SESSION_COOKIE_NAME = AUTHJS_SESSION_COOKIE_NAME;

/**
 * Resolves the Auth.js cookie name and `secure` attribute based on the runtime environment.
 * On Vercel / HTTPS production (`ads.konnexy.com.br`), uses `__Secure-authjs.session-token`
 * with `secure: true` so the cookie matches Auth.js v5 production defaults and browser HTTPS security.
 * On HTTP localhost / Playwright E2E, uses `authjs.session-token` with `secure: false`.
 */
export function resolveActiveAuthCookieConfig(
  rawEnv: Record<string, string | undefined> = process.env
): {
  readonly cookieName: string;
  readonly secure: boolean;
} {
  const appUrl = (rawEnv.NEXT_PUBLIC_APP_URL ?? "").trim().toLowerCase();
  const isHttpsProduction =
    rawEnv.VERCEL === "1" ||
    Boolean(rawEnv.VERCEL_ENV) ||
    (rawEnv.NODE_ENV === "production" && appUrl.startsWith("https://"));

  return isHttpsProduction
    ? { cookieName: SECURE_AUTHJS_SESSION_COOKIE_NAME, secure: true }
    : { cookieName: AUTHJS_SESSION_COOKIE_NAME, secure: false };
}
