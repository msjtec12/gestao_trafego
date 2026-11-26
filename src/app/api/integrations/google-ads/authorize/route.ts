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
    const redirectUri = `${oauthConfig.appUrl}/api/integrations/google-ads/callback`;

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
          redirectUri,
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

    return NextResponse.json(safe, { status });
  }
}
