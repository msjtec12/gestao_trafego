import { NextResponse, type NextRequest } from "next/server";
import { getOperationalPostgresRuntime } from "@/infrastructure/db";
import { resolveSessionFromPostgres } from "@/infrastructure/db/repositories/drizzle-tenant-repositories";
import { PersistentPostgresGoogleAdsService } from "@/integrations/google-ads/google-ads-oauth-and-readonly";
import { SESSION_COOKIE_NAME } from "@/middleware";
import { toPublicSafeErrorMessage } from "@/security/public-errors";

function getVaultKey(): string {
  const envKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (
    envKey &&
    /^[0-9a-fA-F]{64}$/.test(envKey) &&
    new Set(envKey.toLowerCase()).size >= 4
  ) {
    return envKey;
  }
  return "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
}

export async function GET(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const { db } = await getOperationalPostgresRuntime();
    const session = await resolveSessionFromPostgres(db, {
      sessionToken,
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

    const clientId = process.env.GOOGLE_ADS_CLIENT_ID ?? "";
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET ?? "";
    const stateSecret =
      process.env.AUTH_SECRET ??
      "konnexy-ads-default-state-signing-secret-32chars";

    const service = new PersistentPostgresGoogleAdsService(db, getVaultKey());
    const integration = await service.exchangeCodeAndPersistIntegration({
      context: session.context,
      signedState,
      authorizationCode: code,
      clientId,
      clientSecret,
      stateSigningSecret: stateSecret,
      externalAccountLabel: "Google Ads API v26 (OAuth 2.0 Read-Only)",
    });

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
