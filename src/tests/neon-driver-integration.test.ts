// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import * as schema from "@/infrastructure/db/schema";
import {
  applyAllMigrationsToNeonPool,
  DatabaseConfigurationError,
  isLiveNeonConnectionConfigured,
  validateRequiredDatabaseUrl,
  withAdminPostgresConnection,
  withTenantTransaction,
} from "@/infrastructure/db";
import {
  authenticateUserWithPostgres,
  onboardFirstOrganizationRepository,
  PersistentDrizzleTenantRepository,
  resolveSessionFromPostgres,
  revokeSessionInPostgres,
} from "@/infrastructure/db/repositories/drizzle-tenant-repositories";
import { PersistentPostgresGoogleAdsService } from "@/integrations/google-ads/google-ads-oauth-and-readonly";
import { PersistentPostgresAdsSyncEngine } from "@/workflows/incremental-sync-engine";
import {
  MissingOrWeakSecretError,
  requireAuthSecret,
  requireCredentialsEncryptionKey,
  requireOAuthStateSigningSecret,
} from "@/security/env";

const NEON_TEST_URL = process.env.NEON_DISPOSABLE_TEST_DATABASE_URL?.trim() ?? "";
const HAS_AUTHORIZED_DISPOSABLE_NEON = isLiveNeonConnectionConfigured(NEON_TEST_URL);

const TEST_KEY_RING = {
  v1: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  v2: "f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f",
};
const TEST_STATE_SECRET = "neon-disposable-test-oauth-state-hmac-secret-32b";

describe("Stage 2.2 — Production Database & Secret Hardening Guards (Fail-Closed Verification)", () => {
  it("strictly blocks PGlite fallback when NODE_ENV=production or VERCEL=1 and DATABASE_URL is missing/placeholder", () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDbUrl = process.env.DATABASE_URL;
    const prevAllowPg = process.env.KONNEXY_ALLOW_PGLITE_DEV;
    const prevVercel = process.env.VERCEL;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      delete process.env.KONNEXY_ALLOW_PGLITE_DEV;
      process.env.DATABASE_URL =
        "postgresql://neondb_owner:replace_with_password@ep-example.neon.tech/konnexy_ads";

      expect(() => validateRequiredDatabaseUrl()).toThrow(
        DatabaseConfigurationError
      );

      // Even if KONNEXY_ALLOW_PGLITE_DEV="true" is set, VERCEL="1" unconditionally blocks PGlite
      process.env.KONNEXY_ALLOW_PGLITE_DEV = "true";
      process.env.VERCEL = "1";
      expect(() => validateRequiredDatabaseUrl()).toThrow(
        DatabaseConfigurationError
      );
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
      process.env.DATABASE_URL = prevDbUrl;
      process.env.KONNEXY_ALLOW_PGLITE_DEV = prevAllowPg;
      process.env.VERCEL = prevVercel;
    }
  });

  it("strictly rejects missing, placeholder, or low-entropy secrets without hardcoded fallbacks", () => {
    expect(() => requireCredentialsEncryptionKey({})).toThrow(
      MissingOrWeakSecretError
    );
    expect(() =>
      requireCredentialsEncryptionKey({
        CREDENTIALS_ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000000",
      })
    ).toThrow(MissingOrWeakSecretError);

    expect(() => requireAuthSecret({})).toThrow(MissingOrWeakSecretError);
    expect(() =>
      requireAuthSecret({
        AUTH_SECRET: "replace_with_openssl_rand_base64_32_characters_minimum",
      })
    ).toThrow(MissingOrWeakSecretError);

    expect(() => requireOAuthStateSigningSecret({})).toThrow(
      MissingOrWeakSecretError
    );
  });
});

describe.skipIf(!HAS_AUTHORIZED_DISPOSABLE_NEON)(
  "Stage 2.2 — Live Disposable Neon PostgreSQL Driver Integration Suite (NEON_DISPOSABLE_TEST_DATABASE_URL)",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      pool = new Pool({ connectionString: NEON_TEST_URL });
      await applyAllMigrationsToNeonPool(pool);
    });

    afterAll(async () => {
      await pool.end();
    });

    it("executes migrations, roles, RLS tenant isolation, transaction rollback, sessions, Vault encryption, and 9-domain sync on live Neon", async () => {
      const db = drizzle(pool, { schema });
      const uniqueId = Date.now();

      const orgA = await withAdminPostgresConnection(
        async (adminDb) =>
          await onboardFirstOrganizationRepository(adminDb, {
            fullName: "Neon Owner A",
            email: `neon.a.${uniqueId}@konnexy.com.br`,
            password: "NeonStrongPassword#2026",
            organizationName: `Neon Org A ${uniqueId}`,
            organizationSlug: `neon-org-a-${uniqueId}`,
            timezone: "America/Sao_Paulo",
            currencyCode: "BRL",
          }),
        { connectionString: NEON_TEST_URL, forceNeonDriver: true }
      );

      const orgB = await withAdminPostgresConnection(
        async (adminDb) =>
          await onboardFirstOrganizationRepository(adminDb, {
            fullName: "Neon Owner B",
            email: `neon.b.${uniqueId}@konnexy.com.br`,
            password: "NeonStrongPassword#2026",
            organizationName: `Neon Org B ${uniqueId}`,
            organizationSlug: `neon-org-b-${uniqueId}`,
            timezone: "America/Sao_Paulo",
            currencyCode: "BRL",
          }),
        { connectionString: NEON_TEST_URL, forceNeonDriver: true }
      );

      const sessA = await resolveSessionFromPostgres(db, {
        sessionToken: orgA.sessionToken,
      });
      const sessB = await resolveSessionFromPostgres(db, {
        sessionToken: orgB.sessionToken,
      });

      // Create client inside RLS transaction for Org A
      const createdClientA = await withTenantTransaction(
        sessA.context,
        async (tx) => {
          const repo = new PersistentDrizzleTenantRepository(tx);
          return await repo.createClient(sessA.context, {
            name: `Neon Client A ${uniqueId}`,
            industry: "Saúde",
            monthlyBudgetCapCents: 600_000,
            targetCpaCents: 4000,
          });
        },
        { connectionString: NEON_TEST_URL, forceNeonDriver: true }
      );

      // Org B RLS transaction cannot see Org A's client
      const orgBVisibleClients = await withTenantTransaction(
        sessB.context,
        async (tx) => {
          return await tx.select().from(schema.clients);
        },
        { connectionString: NEON_TEST_URL, forceNeonDriver: true }
      );
      expect(
        orgBVisibleClients.some((c) => c.id === createdClientA.id)
      ).toBe(false);

      // Verify transaction rollback on error
      await expect(
        withTenantTransaction(
          sessA.context,
          async (tx) => {
            const repo = new PersistentDrizzleTenantRepository(tx);
            await repo.createClient(sessA.context, {
              name: "Rolled Back Client",
              industry: "Rollback",
              monthlyBudgetCapCents: 100_000,
            });
            throw new Error("FORCE_NEON_ROLLBACK");
          },
          { connectionString: NEON_TEST_URL, forceNeonDriver: true }
        )
      ).rejects.toThrow("FORCE_NEON_ROLLBACK");

      const orgAClientsAfterRollback = await withTenantTransaction(
        sessA.context,
        async (tx) => {
          const repo = new PersistentDrizzleTenantRepository(tx);
          return await repo.listClients(sessA.context);
        },
        { connectionString: NEON_TEST_URL, forceNeonDriver: true }
      );
      expect(orgAClientsAfterRollback).toHaveLength(1);

      // Credential Vault + OAuth single-use state + 9-domain sync on live Neon
      await withTenantTransaction(
        sessA.context,
        async (tx) => {
          const gads = new PersistentPostgresGoogleAdsService(
            tx,
            TEST_KEY_RING,
            "v1"
          );
          const init = await gads.initiatePersistentOAuth({
            context: sessA.context,
            clientId: "123456-neon.apps.googleusercontent.com",
            redirectUri: "https://ads.konnexy.com.br/api/integrations/google-ads/callback",
            stateSigningSecret: TEST_STATE_SECRET,
          });

          const integration = await gads.exchangeCodeAndPersistIntegration({
            context: sessA.context,
            signedState: init.signedState,
            authorizationCode: "code_neon_live",
            clientId: "123456-neon.apps.googleusercontent.com",
            clientSecret: "GOCSPX-neon",
            stateSigningSecret: TEST_STATE_SECRET,
            externalAccountLabel: "Neon Google Ads",
            dnsResolver: async () => [{ address: "142.250.219.10", family: 4 }],
            customPinnedExecutor: async () => ({
              statusCode: 200,
              headers: {},
              bodyText: JSON.stringify({
                access_token: "ya29.neon_access",
                refresh_token: "1//0neon_refresh",
                expires_in: 3600,
              }),
            }),
          });

          const syncEngine = new PersistentPostgresAdsSyncEngine(tx);
          const syncRun = await syncEngine.executePersistentSync({
            context: sessA.context,
            integrationId: integration.id,
            clientId: createdClientA.id,
            provider: "GOOGLE_ADS",
            fetchBatchFn: async () => ({
              checkpointToken: "ckpt-neon-1",
              currencyCode: "BRL",
              timezone: "America/Sao_Paulo",
              isDemoData: false,
              adAccounts: [
                { externalAccountId: "4028819001", name: "Neon Account" },
              ],
              campaigns: [
                {
                  externalCampaignId: "NEON-CAMP-1",
                  name: "Neon Search",
                  dailyBudgetMicros: 100_000_000,
                },
              ],
              adGroups: [],
              ads: [],
              keywords: [],
              searchTerms: [],
              conversions: [],
              dailyMetrics: [],
              budgets: [],
            }),
          });
          expect(syncRun.status).toBe("COMPLETED");
        },
        { connectionString: NEON_TEST_URL, forceNeonDriver: true }
      );

      // Session revocation & login verification
      await revokeSessionInPostgres(db, orgA.sessionToken);
      const relogin = await authenticateUserWithPostgres(db, {
        email: `neon.a.${uniqueId}@konnexy.com.br`,
        password: "NeonStrongPassword#2026",
      });
      expect(relogin.context.organizationId).toBe(orgA.organization.id);
      expect(
        await db
          .select()
          .from(schema.clients)
          .where(eq(schema.clients.id, createdClientA.id))
      ).toHaveLength(1);
    });
  }
);
