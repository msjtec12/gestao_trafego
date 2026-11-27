import { NextResponse, type NextRequest } from "next/server";
import { withTenantTransaction } from "@/infrastructure/db";
import { PersistentPostgresGoogleAdsService } from "@/integrations/google-ads/google-ads-oauth-and-readonly";
import { AUTHJS_SESSION_COOKIE_NAME } from "@/middleware";
import { resolveUnifiedAuthJsPostgresSession } from "@/security/auth";
import {
  requireCredentialsEncryptionKey,
  requireGoogleAdsOAuthConfig,
} from "@/security/env";
import { toPublicSafeErrorMessage } from "@/security/public-errors";

function isBrowserHtmlRequest(request: NextRequest): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

function buildFriendlyUiRedirect(
  request: NextRequest,
  params: {
    readonly status: "error";
    readonly code: string;
    readonly message: string;
  }
): NextResponse {
  const target = new URL("/", request.url);
  target.searchParams.set("googleAdsStatus", params.status);
  target.searchParams.set("googleAdsCode", params.code);
  target.searchParams.set("googleAdsMessage", params.message);
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  try {
    const rawCookie =
      request.cookies.get(AUTHJS_SESSION_COOKIE_NAME)?.value ??
      request.cookies.get(`__Secure-${AUTHJS_SESSION_COOKIE_NAME}`)?.value;

    const session = await resolveUnifiedAuthJsPostgresSession({
      rawCookieOrToken: rawCookie,
    });

    const { keyHex, keyVersion } = requireCredentialsEncryptionKey();
    const oauthConfig = requireGoogleAdsOAuthConfig();

    const authReq = await withTenantTransaction(
      session.context,
      async (tx) => {
        const service = new PersistentPostgresGoogleAdsService(
          tx,
          keyHex,
          keyVersion
        );
        return await service.initiatePersistentOAuth({
          context: session.context,
          clientId: oauthConfig.clientId,
          redirectUri: oauthConfig.redirectUri,
          stateSigningSecret: oauthConfig.stateSigningSecret,
        });
      }
    );

    return NextResponse.redirect(authReq.authorizationUrl);
  } catch (err) {
    const safe = toPublicSafeErrorMessage(
      err,
      "Não foi possível iniciar o fluxo OAuth 2.0 do Google Ads."
    );
    const status =
      safe.errorCode === "UNAUTHENTICATED_ACCESS"
        ? 401
        : safe.errorCode === "RBAC_PERMISSION_DENIED"
          ? 403
          : 422;

    if (status !== 401 && isBrowserHtmlRequest(request)) {
      return buildFriendlyUiRedirect(request, {
        status: "error",
        code: safe.errorCode,
        message: safe.publicMessage,
      });
    }

    return NextResponse.json(safe, { status });
  }
}
