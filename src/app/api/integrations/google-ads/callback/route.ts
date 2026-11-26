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

    const signedState = request.nextUrl.searchParams.get("state") ?? "";
    const code = request.nextUrl.searchParams.get("code") ?? "";

    if (!signedState || !code) {
      return NextResponse.json(
        {
          errorCode: "OAUTH_INVALID_CALLBACK_PARAMS",
          publicMessage:
            "Parâmetros obrigatórios 'code' e 'state' ausentes no callback OAuth.",
        },
        { status: 400 }
      );
    }

    const { keyHex, keyVersion } = requireCredentialsEncryptionKey();
    const oauthConfig = requireGoogleAdsOAuthConfig();

    const integration = await withTenantTransaction(
      session.context,
      async (tx) => {
        const service = new PersistentPostgresGoogleAdsService(
          tx,
          keyHex,
          keyVersion
        );
        return await service.exchangeCodeAndPersistIntegration({
          context: session.context,
          signedState,
          authorizationCode: code,
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          stateSigningSecret: oauthConfig.stateSigningSecret,
          externalAccountLabel: "Google Ads API v26 (OAuth 2.0 Read-Only)",
        });
      }
    );

    return NextResponse.json(
      {
        ok: true,
        integrationId: integration.id,
        status: integration.status,
      },
      { status: 200 }
    );
  } catch (err) {
    const safe = toPublicSafeErrorMessage(
      err,
      "Falha na validação do callback OAuth 2.0."
    );
    const status =
      safe.errorCode === "UNAUTHENTICATED_ACCESS"
        ? 401
        : safe.errorCode === "TENANT_ISOLATION_VIOLATION"
          ? 403
          : 400;

    return NextResponse.json(safe, { status });
  }
}
