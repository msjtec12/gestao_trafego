import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import {
  applyAllMigrationsToPglite,
  withAdminPostgresTransaction,
  withTenantTransaction,
} from "@/infrastructure/db";
import { onboardFirstOrganizationRepository } from "@/infrastructure/db/repositories/drizzle-tenant-repositories";
import {
  buildGoogleAdsReadOnlyHeaders,
  GoogleAdsCloudProjectApprovalError,
  isCloudProjectNotApprovedForProductionError,
  PersistentPostgresGoogleAdsService,
} from "@/integrations/google-ads/google-ads-oauth-and-readonly";
import {
  getGoogleAdsOAuthConfigurationStatus,
  requireGoogleAdsOAuthConfig,
  validateOfficialGoogleAdsCallbackUrl,
} from "@/security/env";
import { toPublicSafeErrorMessage } from "@/security/public-errors";
import type { TenantContext } from "@/domain/types";

describe("Google Ads API — September 9, 2026 Cloud Project Authorization Update", () => {
  it("omits developer-token header by default and never requires GOOGLE_ADS_DEVELOPER_TOKEN", () => {
    const headersWithoutToken = buildGoogleAdsReadOnlyHeaders({
      accessToken: "ya29.valid_access_token",
      managerCustomerId: "123-456-7890",
    });

    expect(headersWithoutToken.Authorization).toBe(
      "Bearer ya29.valid_access_token"
    );
    expect(headersWithoutToken["developer-token"]).toBeUndefined();
    expect(headersWithoutToken["login-customer-id"]).toBe("1234567890");

    // Placeholder developerToken must be silently omitted rather than throwing
    const headersWithPlaceholder = buildGoogleAdsReadOnlyHeaders({
      accessToken: "ya29.valid_access_token",
      developerToken: "replace_with_google_ads_developer_token",
    });
    expect(headersWithPlaceholder["developer-token"]).toBeUndefined();
  });

  it("validates official callback URL and requires only GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET", () => {
    const prodStatusOk = getGoogleAdsOAuthConfigurationStatus({
      NODE_ENV: "production",
      VERCEL: "1",
      NEXT_PUBLIC_APP_URL: "https://ads.konnexy.com.br",
      GOOGLE_ADS_CLIENT_ID: "1234567890-abc.apps.googleusercontent.com",
      GOOGLE_ADS_CLIENT_SECRET: "GOCSPX-valid-secret-value",
    });

    expect(prodStatusOk.configured).toBe(true);
    expect(prodStatusOk.developerTokenRequired).toBe(false);
    expect(prodStatusOk.authMode).toBe("GOOGLE_CLOUD_PROJECT_OAUTH");
    expect(prodStatusOk.callbackUrl).toBe(
      "https://ads.konnexy.com.br/api/integrations/google-ads/callback"
    );
    expect(prodStatusOk.callbackUrlValid).toBe(true);

    // Non-HTTPS callback must be rejected in production
    const prodHttpCheck = validateOfficialGoogleAdsCallbackUrl(
      "http://ads.konnexy.com.br",
      { NODE_ENV: "production", VERCEL: "1" }
    );
    expect(prodHttpCheck.valid).toBe(false);
    expect(prodHttpCheck.error).toContain("HTTPS");

    // requireGoogleAdsOAuthConfig succeeds WITHOUT GOOGLE_ADS_DEVELOPER_TOKEN
    const required = requireGoogleAdsOAuthConfig({
      NODE_ENV: "production",
      VERCEL: "1",
      NEXT_PUBLIC_APP_URL: "https://ads.konnexy.com.br/",
      GOOGLE_ADS_CLIENT_ID: "1234567890-abc.apps.googleusercontent.com",
      GOOGLE_ADS_CLIENT_SECRET: "GOCSPX-valid-secret-value",
      AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
    });
    expect(required.redirectUri).toBe(
      "https://ads.konnexy.com.br/api/integrations/google-ads/callback"
    );

    // Missing CLIENT_SECRET still fails closed
    expect(() =>
      requireGoogleAdsOAuthConfig({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://ads.konnexy.com.br",
        GOOGLE_ADS_CLIENT_ID: "1234567890-abc.apps.googleusercontent.com",
        AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
      })
    ).toThrow(/GOOGLE_ADS_CLIENT_SECRET/);
  });

  it("detects CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION in REST responses and returns friendly pt-BR guidance", async () => {
    const rawGoogleErrorBody = JSON.stringify({
      error: {
        code: 403,
        message: "The caller does not have permission",
        status: "PERMISSION_DENIED",
        details: [
          {
            errors: [
              {
                errorCode: {
                  authorizationError:
                    "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION",
                },
                message:
                  "The Google Cloud project is only approved for test accounts.",
              },
            ],
          },
        ],
      },
    });

    expect(isCloudProjectNotApprovedForProductionError(rawGoogleErrorBody)).toBe(
      true
    );

    const pg = new PGlite();
    await applyAllMigrationsToPglite(pg);
    try {
      const onboarded = await withAdminPostgresTransaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE konnexy_app`);
          return await onboardFirstOrganizationRepository(tx, {
            fullName: "Google Ads Tester",
            email: "gads2026@konnexy.com.br",
            password: "StrongPassword!2026",
            organizationName: "Konnexy Ads 2026",
            organizationSlug: "konnexy-ads-2026",
            timezone: "America/Sao_Paulo",
            currencyCode: "BRL",
          });
        },
        { customPg: pg }
      );

      const ctx: TenantContext = {
        organizationId: onboarded.organization.id,
        organizationSlug: onboarded.organization.slug,
        userId: onboarded.user.id,
        role: "OWNER",
        executionMode: "READ_ONLY",
        emergencyStopActive: false,
      };
      const keyHex = crypto.randomBytes(32).toString("hex");
      const stateSecret = crypto.randomBytes(32).toString("hex");

      const integration = await withTenantTransaction(
        ctx,
        async (tx) => {
          const svc = new PersistentPostgresGoogleAdsService(tx, keyHex, "v1");
          const init = await svc.initiatePersistentOAuth({
            context: ctx,
            clientId: "123456.apps.googleusercontent.com",
            redirectUri:
              "https://ads.konnexy.com.br/api/integrations/google-ads/callback",
            stateSigningSecret: stateSecret,
          });
          return await svc.exchangeCodeAndPersistIntegration({
            context: ctx,
            signedState: init.signedState,
            authorizationCode: "auth-code-123",
            clientId: "123456.apps.googleusercontent.com",
            clientSecret: "secret-123",
            stateSigningSecret: stateSecret,
            externalAccountLabel: "Google Ads Test",
            dnsResolver: async () => [{ address: "142.250.190.78", family: 4 }],
            customPinnedExecutor: async () => ({
              statusCode: 200,
              headers: {},
              bodyText: JSON.stringify({
                access_token: "ya29.mock_access",
                refresh_token: "1//0mock_refresh",
                expires_in: 3600,
                scope: "https://www.googleapis.com/auth/adwords",
              }),
            }),
          });
        },
        { customPg: pg }
      );

      // 1. listAccessibleCustomersViaRest throws GoogleAdsCloudProjectApprovalError
      await expect(
        withTenantTransaction(
          ctx,
          async (tx) => {
            const svc = new PersistentPostgresGoogleAdsService(
              tx,
              keyHex,
              "v1"
            );
            return await svc.listAccessibleCustomersViaRest({
              context: ctx,
              integrationId: integration.id,
              dnsResolver: async () => [
                { address: "142.250.190.78", family: 4 },
              ],
              customPinnedExecutor: async () => ({
                statusCode: 403,
                headers: {},
                bodyText: rawGoogleErrorBody,
              }),
            });
          },
          { customPg: pg }
        )
      ).rejects.toBeInstanceOf(GoogleAdsCloudProjectApprovalError);

      // 2. executeReadOnlyGaqlSearchViaRest throws GoogleAdsCloudProjectApprovalError without developerToken
      let gaqlErr: unknown = null;
      try {
        await withTenantTransaction(
          ctx,
          async (tx) => {
            const svc = new PersistentPostgresGoogleAdsService(
              tx,
              keyHex,
              "v1"
            );
            return await svc.executeReadOnlyGaqlSearchViaRest({
              context: ctx,
              integrationId: integration.id,
              customerId: "123-456-7890",
              gaqlQuery: "SELECT campaign.id FROM campaign",
              dnsResolver: async () => [
                { address: "142.250.190.78", family: 4 },
              ],
              customPinnedExecutor: async () => ({
                statusCode: 403,
                headers: {},
                bodyText: rawGoogleErrorBody,
              }),
            });
          },
          { customPg: pg }
        );
      } catch (err) {
        gaqlErr = err;
      }

      expect(gaqlErr).toBeInstanceOf(GoogleAdsCloudProjectApprovalError);
      const safe = toPublicSafeErrorMessage(gaqlErr);
      expect(safe.errorCode).toBe("CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION");
      expect(safe.publicMessage).toContain("Acesso de Teste");
    } finally {
      await pg.close();
    }
  });
});
