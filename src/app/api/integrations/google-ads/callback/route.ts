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

function redirectWithUiStatus(
  request: NextRequest,
  params: {
    readonly status: "connected" | "error";
    readonly code?: string;
    readonly message?: string;
  }
): NextResponse {
  const target = new URL("/", request.url);
  target.searchParams.set("googleAdsStatus", params.status);
  if (params.code) target.searchParams.set("googleAdsCode", params.code);
  if (params.message) {
    target.searchParams.set("googleAdsMessage", params.message);
  }
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  const browserRequest = isBrowserHtmlRequest(request);

  try {
    const rawCookie =
      request.cookies.get(AUTHJS_SESSION_COOKIE_NAME)?.value ??
      request.cookies.get(`__Secure-${AUTHJS_SESSION_COOKIE_NAME}`)?.value;

    const session = await resolveUnifiedAuthJsPostgresSession({
      rawCookieOrToken: rawCookie,
    });

    const oauthError = request.nextUrl.searchParams.get("error")?.trim();
    if (oauthError) {
      const msg =
        oauthError === "access_denied"
          ? "Autorização cancelada no Google Ads. Você pode tentar conectar novamente quando desejar."
          : `O Google retornou um erro na autorização OAuth 2.0 (${oauthError}).`;

      if (browserRequest) {
        return redirectWithUiStatus(request, {
          status: "error",
          code: "GOOGLE_ADS_OAUTH_DENIED",
          message: msg,
        });
      }

      return NextResponse.json(
        { errorCode: "GOOGLE_ADS_OAUTH_DENIED", publicMessage: msg },
        { status: 400 }
      );
    }

    const signedState = request.nextUrl.searchParams.get("state") ?? "";
    const code = request.nextUrl.searchParams.get("code") ?? "";

    if (!signedState || !code) {
      const msg =
        "Parâmetros obrigatórios 'code' e 'state' ausentes no retorno do Google Ads. Inicie a conexão novamente pela interface.";
      if (browserRequest) {
        return redirectWithUiStatus(request, {
          status: "error",
          code: "OAUTH_INVALID_CALLBACK_PARAMS",
          message: msg,
        });
      }
      return NextResponse.json(
        {
          errorCode: "OAUTH_INVALID_CALLBACK_PARAMS",
          publicMessage: msg,
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
          externalAccountLabel:
            "Google Ads API v26 (Google Cloud Project OAuth Read-Only)",
        });
      }
    );

    if (browserRequest) {
      return redirectWithUiStatus(request, {
        status: "connected",
        message:
          "Google Ads conectado com sucesso em modo somente leitura (READ_ONLY).",
      });
    }

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
      "Falha na validação do callback OAuth 2.0 do Google Ads."
    );
    const status =
      safe.errorCode === "UNAUTHENTICATED_ACCESS"
        ? 401
        : safe.errorCode === "TENANT_ISOLATION_VIOLATION"
          ? 403
          : 400;

    if (status !== 401 && browserRequest) {
      return redirectWithUiStatus(request, {
        status: "error",
        code: safe.errorCode,
        message: safe.publicMessage,
      });
    }

    return NextResponse.json(safe, { status });
  }
}
