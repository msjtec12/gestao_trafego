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

    const clientId = process.env.GOOGLE_ADS_CLIENT_ID ?? "";
    const stateSecret =
      process.env.AUTH_SECRET ??
      "konnexy-ads-default-state-signing-secret-32chars";
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const redirectUri = `${appUrl}/api/integrations/google-ads/callback`;

    const service = new PersistentPostgresGoogleAdsService(db, getVaultKey());
    const authReq = await service.initiatePersistentOAuth({
      context: session.context,
      clientId,
      redirectUri,
      stateSigningSecret: stateSecret,
    });

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
