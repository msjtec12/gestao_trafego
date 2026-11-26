import crypto from "crypto";
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { encode, decode } from "next-auth/jwt";
import { eq, sql } from "drizzle-orm";
import {
  applyAllMigrationsToPglite,
  DatabaseConfigurationError,
  isLiveNeonConnectionConfigured,
  withAdminPostgresTransaction,
} from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";
import {
  authenticateUserWithPostgres,
  onboardFirstOrganizationRepository,
  resolveSessionFromPostgres,
  revokeSessionInPostgres,
} from "@/infrastructure/db/repositories/drizzle-tenant-repositories";
import {
  AUTHJS_SESSION_COOKIE_NAME,
  resolveActiveAuthCookieConfig,
  SECURE_AUTHJS_SESSION_COOKIE_NAME,
} from "@/security/auth-cookie-config";
import { MissingOrWeakSecretError } from "@/security/env";
import { UnauthenticatedAccessError } from "@/security/session-guard";
import {
  createRequestCorrelationId,
  extractPostgresErrorMetadata,
  logStructuredServerFailure,
} from "@/security/structured-logger";

async function createNonSuperuserNeonSimulatedPg(): Promise<PGlite> {
  const pg = new PGlite();
  await applyAllMigrationsToPglite(pg);

  // Simulate Neon PostgreSQL 17 `konnexy_ads_owner`: non-superuser, NOBYPASSRLS,
  // subject to FORCE ROW LEVEL SECURITY on all operational tables.
  await pg.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konnexy_neon_owner_sim') THEN
        CREATE ROLE konnexy_neon_owner_sim NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
    END
    $$;
    GRANT USAGE ON SCHEMA public TO konnexy_neon_owner_sim;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO konnexy_neon_owner_sim;
    GRANT konnexy_app TO konnexy_neon_owner_sim;
  `);

  return pg;
}

describe("Production Onboarding — Neon PG17 FORCE RLS, Atomicity, WebSocket & Auth.js Cookies", () => {
  it("configures neonConfig.webSocketConstructor for Vercel Node.js Serverless Pool", () => {
    expect(neonConfig.webSocketConstructor).toBeTruthy();
    expect(typeof neonConfig.webSocketConstructor).toBe("function");
  });

  it("reproduces Neon PG17 SQLSTATE 42501 when inserting into organizations without RLS context and proves the fix succeeds atomically", async () => {
    const pg = await createNonSuperuserNeonSimulatedPg();
    try {
      // 1. Reproduce the exact production failure: non-superuser inserting into `organizations`
      //    under FORCE ROW LEVEL SECURITY without setting `app.current_organization_id`.
      let rawRlsError: unknown = null;
      try {
        await withAdminPostgresTransaction(
          async (tx) => {
            await tx.execute(sql`SET LOCAL ROLE konnexy_neon_owner_sim`);
            await tx.insert(schema.organizations).values({
              name: "Sem Contexto RLS",
              slug: "sem-contexto-rls",
              executionMode: "READ_ONLY",
              emergencyStopActive: false,
              timezone: "America/Sao_Paulo",
              currencyCode: "BRL",
            });
          },
          { customPg: pg }
        );
      } catch (err) {
        rawRlsError = err;
      }

      expect(rawRlsError).toBeTruthy();
      const rlsMeta = extractPostgresErrorMetadata(rawRlsError);
      expect(rlsMeta.pgCode).toBe("42501");
      expect(rlsMeta.category).toBe("INSUFFICIENT_PERMISSION_OR_RLS");

      // 2. Prove the fixed atomic onboarding transaction succeeds under the exact same
      //    non-superuser role with FORCE ROW LEVEL SECURITY active.
      const executedSteps: string[] = [];
      const onboarded = await withAdminPostgresTransaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE konnexy_neon_owner_sim`);
          const created = await onboardFirstOrganizationRepository(
            tx,
            {
              fullName: "Massami Shitara",
              email: "diretoria@konnexy.com.br",
              password: "KonnexyProdPassword!2026",
              organizationName: "Konnexy Performance",
              organizationSlug: "konnexy-performance",
              timezone: "America/Sao_Paulo",
              currencyCode: "BRL",
            },
            {
              onStep: (step) => executedSteps.push(step),
            }
          );

          await tx.insert(schema.integrations).values({
            organizationId: created.organization.id,
            provider: "GOOGLE_ADS",
            externalAccountLabel: "Google Ads API v26 (OAuth 2.0 Read-Only)",
            status: "ERROR",
            isDemoIntegration: false,
          });

          return created;
        },
        { customPg: pg }
      );

      expect(onboarded.user.email).toBe("diretoria@konnexy.com.br");
      expect(onboarded.organization.slug).toBe("konnexy-performance");
      expect(onboarded.organization.executionMode).toBe("READ_ONLY");
      expect(onboarded.membership.role).toBe("OWNER");
      expect(onboarded.sessionToken.startsWith("ksess_")).toBe(true);
      expect(executedSteps).toContain("set_rls_org_context");
      expect(executedSteps).toContain("insert_organization");
      expect(executedSteps).toContain("insert_owner_membership");
      expect(executedSteps).toContain("insert_audit_log");

      // 3. Prove session resolution (dashboard load after redirect to `/`),
      //    logout, and subsequent login ALL work under the same non-superuser FORCE RLS role.
      const resolved = await withAdminPostgresTransaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE konnexy_neon_owner_sim`);
          return await resolveSessionFromPostgres(tx, {
            sessionToken: onboarded.sessionToken,
          });
        },
        { customPg: pg }
      );

      expect(resolved.context.organizationId).toBe(onboarded.organization.id);
      expect(resolved.context.role).toBe("OWNER");
      expect(resolved.context.executionMode).toBe("READ_ONLY");

      await withAdminPostgresTransaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE konnexy_neon_owner_sim`);
          await revokeSessionInPostgres(tx, onboarded.sessionToken);
        },
        { customPg: pg }
      );

      const relogin = await withAdminPostgresTransaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE konnexy_neon_owner_sim`);
          return await authenticateUserWithPostgres(tx, {
            email: "diretoria@konnexy.com.br",
            password: "KonnexyProdPassword!2026",
          });
        },
        { customPg: pg }
      );

      expect(relogin.context.organizationId).toBe(onboarded.organization.id);
      expect(relogin.user.email).toBe("diretoria@konnexy.com.br");
    } finally {
      await pg.close();
    }
  });

  it("guarantees full transactional atomicity (rolls back user/org/membership on mid-transaction failure)", async () => {
    const pg = await createNonSuperuserNeonSimulatedPg();
    try {
      await expect(
        withAdminPostgresTransaction(
          async (tx) => {
            await tx.execute(sql`SET LOCAL ROLE konnexy_neon_owner_sim`);
            await onboardFirstOrganizationRepository(tx, {
              fullName: "Rollback Test",
              email: "rollback@konnexy.com.br",
              password: "RollbackPassword!2026",
              organizationName: "Rollback Org",
              organizationSlug: "rollback-org",
              timezone: "America/Sao_Paulo",
              currencyCode: "BRL",
            });
            throw new Error("Simulated integration write failure");
          },
          { customPg: pg }
        )
      ).rejects.toThrow("Simulated integration write failure");

      // Verify zero orphan users or organizations remain after rollback
      const usersCount = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users WHERE email = 'rollback@konnexy.com.br'`
      );
      const orgsCount = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM organizations WHERE slug = 'rollback-org'`
      );
      expect(usersCount.rows[0]?.count).toBe("0");
      expect(orgsCount.rows[0]?.count).toBe("0");
    } finally {
      await pg.close();
    }
  });

  it("returns specific DUPLICATE_EMAIL and DUPLICATE_SLUG categories even when FORCE RLS hides other tenants", async () => {
    const pg = await createNonSuperuserNeonSimulatedPg();
    try {
      await withAdminPostgresTransaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE konnexy_neon_owner_sim`);
          await onboardFirstOrganizationRepository(tx, {
            fullName: "Primeiro Owner",
            email: "owner1@konnexy.com.br",
            password: "StrongPassword!2026",
            organizationName: "Agencia Alpha",
            organizationSlug: "agencia-alpha",
            timezone: "America/Sao_Paulo",
            currencyCode: "BRL",
          });
        },
        { customPg: pg }
      );

      // Duplicate email
      let dupEmailErr: unknown = null;
      try {
        await withAdminPostgresTransaction(
          async (tx) => {
            await tx.execute(sql`SET LOCAL ROLE konnexy_neon_owner_sim`);
            await onboardFirstOrganizationRepository(tx, {
              fullName: "Segundo Owner",
              email: "owner1@konnexy.com.br",
              password: "StrongPassword!2026",
              organizationName: "Agencia Beta",
              organizationSlug: "agencia-beta",
              timezone: "America/Sao_Paulo",
              currencyCode: "BRL",
            });
          },
          { customPg: pg }
        );
      } catch (err) {
        dupEmailErr = err;
      }
      expect(extractPostgresErrorMetadata(dupEmailErr).category).toBe(
        "DUPLICATE_EMAIL"
      );

      // Duplicate slug (under FORCE RLS, SELECT organizations returns 0 rows,
      // so PostgreSQL unique constraint 23505 enforces uniqueness!)
      let dupSlugErr: unknown = null;
      try {
        await withAdminPostgresTransaction(
          async (tx) => {
            await tx.execute(sql`SET LOCAL ROLE konnexy_neon_owner_sim`);
            await onboardFirstOrganizationRepository(tx, {
              fullName: "Terceiro Owner",
              email: "owner3@konnexy.com.br",
              password: "StrongPassword!2026",
              organizationName: "Agencia Alpha Clone",
              organizationSlug: "agencia-alpha",
              timezone: "America/Sao_Paulo",
              currencyCode: "BRL",
            });
          },
          { customPg: pg }
        );
      } catch (err) {
        dupSlugErr = err;
      }
      const dupSlugMeta = extractPostgresErrorMetadata(dupSlugErr);
      expect(dupSlugMeta.category).toBe("DUPLICATE_SLUG");
      expect(dupSlugMeta.publicMessage).toContain("slug");

      // Verify failed duplicate slug attempt rolled back `owner3@konnexy.com.br` cleanly
      const orphanUsers = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users WHERE email = 'owner3@konnexy.com.br'`
      );
      expect(orphanUsers.rows[0]?.count).toBe("0");
    } finally {
      await pg.close();
    }
  });

  it("maps all 6 required error categories safely and emits sanitized structured JSON logs without leaking secrets", () => {
    const dbUnavailable = extractPostgresErrorMetadata(
      Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), {
        code: "08006",
      })
    );
    expect(dbUnavailable.category).toBe("DATABASE_UNAVAILABLE");

    const missingConfig = extractPostgresErrorMetadata(
      new DatabaseConfigurationError("DATABASE_URL missing")
    );
    expect(missingConfig.category).toBe("CONFIGURATION_MISSING");

    const missingSecret = extractPostgresErrorMetadata(
      new MissingOrWeakSecretError("AUTH_SECRET", "AUTH_SECRET ausente")
    );
    expect(missingSecret.category).toBe("CONFIGURATION_MISSING");

    const authFailed = extractPostgresErrorMetadata(
      new UnauthenticatedAccessError("E-mail ou senha inválidos.")
    );
    expect(authFailed.category).toBe("AUTHENTICATION_FAILED");

    const rlsDenied = extractPostgresErrorMetadata(
      Object.assign(new Error("Failed query: insert into memberships"), {
        cause: Object.assign(
          new Error(
            'new row violates row-level security policy for table "memberships"'
          ),
          { code: "42501", table: "memberships" }
        ),
      })
    );
    expect(rlsDenied.category).toBe("INSUFFICIENT_PERMISSION_OR_RLS");
    expect(rlsDenied.pgCode).toBe("42501");

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const reqId = createRequestCorrelationId();
      logStructuredServerFailure({
        requestId: reqId,
        flow: "onboarding",
        step: "insert_organization",
        operation: "onboardOrganizationAction",
        error: new Error(
          "postgres://konnexy_ads_owner:SuperSecretPass123@ep-prod.neon.tech/neondb failed with Bearer secret_tok_999"
        ),
      });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const loggedJson = String(consoleSpy.mock.calls[0]?.[0] ?? "");
      expect(loggedJson).toContain(reqId);
      expect(loggedJson).toContain('"step":"insert_organization"');
      expect(loggedJson).toContain('"operation":"onboardOrganizationAction"');
      expect(loggedJson).not.toContain("SuperSecretPass123");
      expect(loggedJson).not.toContain("secret_tok_999");
      expect(loggedJson).not.toContain("postgres://");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("configures Auth.js HTTPS __Secure- cookie in production and HTTP cookie on localhost with matching JWT salt", async () => {
    const prodVercel = resolveActiveAuthCookieConfig({
      NODE_ENV: "production",
      VERCEL: "1",
      NEXT_PUBLIC_APP_URL: "https://ads.konnexy.com.br",
    });
    expect(prodVercel.cookieName).toBe(SECURE_AUTHJS_SESSION_COOKIE_NAME);
    expect(prodVercel.secure).toBe(true);

    const localHttp = resolveActiveAuthCookieConfig({
      NODE_ENV: "development",
      NEXT_PUBLIC_APP_URL: "http://localhost:3100",
    });
    expect(localHttp.cookieName).toBe(AUTHJS_SESSION_COOKIE_NAME);
    expect(localHttp.secure).toBe(false);

    // Verify JWT round-trip with production __Secure- salt
    const secret = crypto.randomBytes(32).toString("hex");
    const encoded = await encode({
      secret,
      salt: SECURE_AUTHJS_SESSION_COOKIE_NAME,
      maxAge: 3600,
      token: {
        sub: "user-1",
        dbSessionToken: "ksess_test_token_123456",
        activeOrganizationId: "org-1",
      },
    });
    const decoded = await decode({
      secret,
      salt: SECURE_AUTHJS_SESSION_COOKIE_NAME,
      token: encoded,
    });
    expect(decoded?.dbSessionToken).toBe("ksess_test_token_123456");
  });
});

const LIVE_NEON_STAGING_URL =
  process.env.NEON_STAGING_DATABASE_URL?.trim() ||
  process.env.NEON_DISPOSABLE_TEST_DATABASE_URL?.trim() ||
  "";

describe.skipIf(!isLiveNeonConnectionConfigured(LIVE_NEON_STAGING_URL))(
  "Live Neon Staging Integration — Transactional Onboarding & RLS (No Re-Migration)",
  () => {
    it("executes full atomic onboarding + session resolution + cleanup on live Neon staging", async () => {
      const suffix = crypto.randomBytes(4).toString("hex");
      const testEmail = `staging-onboard-${suffix}@konnexy.com.br`;
      const testSlug = `staging-onboard-${suffix}`;

      const onboarded = await withAdminPostgresTransaction(
        async (tx) => {
          const created = await onboardFirstOrganizationRepository(tx, {
            fullName: "Neon Staging Verification",
            email: testEmail,
            password: "StagingNeonPassword!2026",
            organizationName: `Staging Org ${suffix}`,
            organizationSlug: testSlug,
            timezone: "America/Sao_Paulo",
            currencyCode: "BRL",
          });

          await tx.insert(schema.integrations).values({
            organizationId: created.organization.id,
            provider: "GOOGLE_ADS",
            externalAccountLabel: "Google Ads API v26 (OAuth 2.0 Read-Only)",
            status: "ERROR",
            isDemoIntegration: false,
          });

          return created;
        },
        { connectionString: LIVE_NEON_STAGING_URL, forceNeonDriver: true }
      );

      expect(onboarded.organization.slug).toBe(testSlug);
      expect(onboarded.membership.role).toBe("OWNER");

      const resolved = await withAdminPostgresTransaction(
        async (tx) => {
          return await resolveSessionFromPostgres(tx, {
            sessionToken: onboarded.sessionToken,
          });
        },
        { connectionString: LIVE_NEON_STAGING_URL, forceNeonDriver: true }
      );

      expect(resolved.context.organizationId).toBe(onboarded.organization.id);
      expect(resolved.context.executionMode).toBe("READ_ONLY");

      // Clean up test session & user (audit_logs remain immutable by design)
      await withAdminPostgresTransaction(
        async (tx) => {
          await tx
            .delete(schema.userSessions)
            .where(eq(schema.userSessions.userId, onboarded.user.id));
        },
        { connectionString: LIVE_NEON_STAGING_URL, forceNeonDriver: true }
      );
    });
  }
);
