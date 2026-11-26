// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/infrastructure/db/schema";
import {
  applyAllMigrationsToPglite,
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
import { executePinnedHttpsRequest } from "@/security/secure-http-transport";
import {
  PermissionDeniedError,
  TenantIsolationError,
} from "@/security/rbac-and-tenant";
import { UnauthenticatedAccessError } from "@/security/session-guard";

const KEY_RING = {
  v1: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  v2: "f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f",
};
const STATE_SECRET = "stage2-1-oauth-state-hmac-secret-key-32bytes";

describe("Stage 2.1 Operational Completion — Full PostgreSQL Persistence, Auth, OAuth Vault, SSRF & 9-Domain Sync", () => {
  let pg: PGlite;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;

  beforeAll(async () => {
    pg = new PGlite();
    await applyAllMigrationsToPglite(pg);
    db = drizzle(pg, { schema });
  });

  afterAll(async () => {
    await pg.close();
  });

  it("1. Authentication: Onboarding, Valid Login, Invalid Login Durable Rate Limit, Expired Session & Logout", async () => {
    const onboarded = await onboardFirstOrganizationRepository(
      db,
      {
        fullName: "Helena Operacional",
        email: "helena.ops@konnexy.com.br",
        password: "OperationalPassword#2026",
        organizationName: "Konnexy Operacional Ltda",
        organizationSlug: "konnexy-ops-ltda",
        timezone: "America/Sao_Paulo",
        currencyCode: "BRL",
      },
      { nowMs: 1_000_000 }
    );

    expect(onboarded.organization.executionMode).toBe("READ_ONLY");
    expect(onboarded.sessionToken.startsWith("ksess_")).toBe(true);

    // Valid session resolution from PostgreSQL
    const resolved = await resolveSessionFromPostgres(db, {
      sessionToken: onboarded.sessionToken,
      nowMs: 1_050_000,
    });
    expect(resolved.user.email).toBe("helena.ops@konnexy.com.br");
    expect(resolved.context.role).toBe("OWNER");

    // Expired session check
    await expect(
      resolveSessionFromPostgres(db, {
        sessionToken: onboarded.sessionToken,
        nowMs: 1_000_000 + 9 * 60 * 60 * 1000,
      })
    ).rejects.toThrow(/Sessão expirada/);

    // Logout revokes session in PostgreSQL
    await revokeSessionInPostgres(db, onboarded.sessionToken);
    await expect(
      resolveSessionFromPostgres(db, {
        sessionToken: onboarded.sessionToken,
        nowMs: 1_050_000,
      })
    ).rejects.toThrow(/Sessão encerrada/);

    // Valid fresh login against PostgreSQL `users` table
    const freshLogin = await authenticateUserWithPostgres(db, {
      email: "helena.ops@konnexy.com.br",
      password: "OperationalPassword#2026",
      nowMs: 2_000_000,
    });
    expect(freshLogin.sessionToken).not.toBe(onboarded.sessionToken);

    // Invalid login attempts recorded in `auth_rate_limits` until locked (5 attempts)
    for (let i = 1; i <= 5; i++) {
      await expect(
        authenticateUserWithPostgres(db, {
          email: "helena.ops@konnexy.com.br",
          password: "WrongPassword#000",
          nowMs: 3_000_000 + i * 100,
        })
      ).rejects.toThrow(UnauthenticatedAccessError);
    }

    // 6th attempt even with correct password is blocked by durable PostgreSQL rate limit lockout
    await expect(
      authenticateUserWithPostgres(db, {
        email: "helena.ops@konnexy.com.br",
        password: "OperationalPassword#2026",
        nowMs: 3_001_000,
      })
    ).rejects.toThrow(/Muitas tentativas de login/);
  });

  it("2. Multi-Tenancy: Cross-Org Read/Write Isolation, CLIENT_VIEWER DB Scope, Permission Escalation Guard & Transactional Context", async () => {
    const orgA = await onboardFirstOrganizationRepository(db, {
      fullName: "Owner Org A",
      email: "owner.a@konnexy.com.br",
      password: "PasswordOrgA#2026",
      organizationName: "Agencia Alpha",
      organizationSlug: "agencia-alpha-s21",
      timezone: "America/Sao_Paulo",
      currencyCode: "BRL",
    });

    const orgB = await onboardFirstOrganizationRepository(db, {
      fullName: "Owner Org B",
      email: "owner.b@konnexy.com.br",
      password: "PasswordOrgB#2026",
      organizationName: "Agencia Beta",
      organizationSlug: "agencia-beta-s21",
      timezone: "America/Sao_Paulo",
      currencyCode: "BRL",
    });

    const sessA = await resolveSessionFromPostgres(db, {
      sessionToken: orgA.sessionToken,
    });
    const sessB = await resolveSessionFromPostgres(db, {
      sessionToken: orgB.sessionToken,
    });

    const repo = new PersistentDrizzleTenantRepository(db);

    const clientA1 = await repo.createClient(sessA.context, {
      name: "Cliente Alpha 01",
      industry: "Odontologia",
      monthlyBudgetCapCents: 500_000,
      targetCpaCents: 4000,
    });
    const clientA2 = await repo.createClient(sessA.context, {
      name: "Cliente Alpha 02",
      industry: "Estetica",
      monthlyBudgetCapCents: 700_000,
      targetCpaCents: 3500,
    });

    // Org B cannot see or edit Org A clients
    const orgBClients = await repo.listClients(sessB.context);
    expect(orgBClients).toHaveLength(0);

    await expect(
      repo.updateClient(sessB.context, {
        clientId: clientA1.id,
        name: "Tentativa Cross-Tenant",
        industry: "Hack",
        monthlyBudgetCapCents: 100,
      })
    ).rejects.toThrow(TenantIsolationError);

    // Create a CLIENT_VIEWER member in Org A assigned ONLY to clientA1 in PostgreSQL `member_client_access`
    const [viewerUser] = await db
      .insert(schema.users)
      .values({
        email: "viewer.a1@cliente.com.br",
        fullName: "Viewer Cliente A1",
        passwordHash: orgA.user.passwordHash,
        isActive: true,
      })
      .returning();

    const [viewerMembership] = await db
      .insert(schema.memberships)
      .values({
        organizationId: orgA.organization.id,
        userId: viewerUser.id,
        role: "CLIENT_VIEWER",
      })
      .returning();

    await repo.assignClientToViewer(sessA.context, {
      membershipId: viewerMembership.id,
      clientId: clientA1.id,
    });

    const viewerLogin = await authenticateUserWithPostgres(db, {
      email: "viewer.a1@cliente.com.br",
      password: "PasswordOrgA#2026",
    });

    expect(viewerLogin.context.role).toBe("CLIENT_VIEWER");
    expect(viewerLogin.context.allowedClientIds).toEqual([clientA1.id]);

    const visibleToViewer = await repo.listClients(viewerLogin.context);
    expect(visibleToViewer).toHaveLength(1);
    expect(visibleToViewer[0]?.id).toBe(clientA1.id);
    expect(visibleToViewer.some((c) => c.id === clientA2.id)).toBe(false);

    // CLIENT_VIEWER cannot escalate permissions or create clients
    await expect(
      repo.updateMemberRole(viewerLogin.context, {
        membershipId: viewerMembership.id,
        newRole: "OWNER",
      })
    ).rejects.toThrow(PermissionDeniedError);

    // Verify transactional RLS context execution via withTenantTransaction
    const rlsClients = await withTenantTransaction(
      sessA.context,
      async (tx) => {
        return await tx.select().from(schema.clients);
      },
      { customPg: pg }
    );
    expect(rlsClients).toHaveLength(2);
    expect(
      rlsClients.every(
        (c: { organizationId: string }) =>
          c.organizationId === orgA.organization.id
      )
    ).toBe(true);
  });

  it("3. Integrations, OAuth Single-Use State, Vault Persistence, Key Rotation, Token Refresh, Revocation, GAQL v26 & SSRF Pinning", async () => {
    const org = await onboardFirstOrganizationRepository(db, {
      fullName: "Owner Integracoes",
      email: "oauth.owner@konnexy.com.br",
      password: "PasswordOAuth#2026",
      organizationName: "Agencia OAuth Google",
      organizationSlug: "agencia-oauth-google",
      timezone: "America/Sao_Paulo",
      currencyCode: "BRL",
    });
    const sess = await resolveSessionFromPostgres(db, {
      sessionToken: org.sessionToken,
    });

    const googleService = new PersistentPostgresGoogleAdsService(
      db,
      KEY_RING,
      "v1"
    );

    const authInit = await googleService.initiatePersistentOAuth({
      context: sess.context,
      clientId: "99887766-googleads.apps.googleusercontent.com",
      redirectUri: "https://ads.konnexy.com.br/api/integrations/google-ads/callback",
      stateSigningSecret: STATE_SECRET,
      nowMs: 5_000_000,
    });

    const publicDnsResolver = async () => [
      { address: "142.250.219.10", family: 4 },
    ];

    // Exchange code and persist encrypted tokens in PostgreSQL `integrations`
    const connected = await googleService.exchangeCodeAndPersistIntegration({
      context: sess.context,
      signedState: authInit.signedState,
      authorizationCode: "4/0AeanS0_valid_google_oauth_code",
      clientId: "99887766-googleads.apps.googleusercontent.com",
      clientSecret: "GOCSPX-valid_client_secret",
      stateSigningSecret: STATE_SECRET,
      externalAccountLabel: "MCC Principal Konnexy",
      managerCustomerId: "990-100-2000",
      nowMs: 5_010_000,
      dnsResolver: publicDnsResolver,
      customPinnedExecutor: async (req) => {
        // Verify IP pinning and TLS SNI servername preservation
        expect(req.pinnedAddress).toBe("142.250.219.10");
        expect(req.servername).toBe("oauth2.googleapis.com");
        return {
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            access_token: "ya29.initial_persisted_access_token",
            refresh_token: "1//0initial_persisted_refresh_token",
            expires_in: 3600,
          }),
        };
      },
    });

    expect(connected.status).toBe("CONNECTED");
    expect("encryptedAccessToken" in connected).toBe(false);

    // Reusing the exact same OAuth state MUST fail (single-use enforcement in PostgreSQL `oauth_states`)
    await expect(
      googleService.consumeSingleUseOAuthState({
        context: sess.context,
        signedState: authInit.signedState,
        stateSigningSecret: STATE_SECRET,
        nowMs: 5_015_000,
      })
    ).rejects.toThrow(/already been used/);

    // Verify encrypted ciphertext is actually stored in PostgreSQL and not plaintext
    const [rawDbIntegration] = await db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.id, connected.id));

    expect(rawDbIntegration.encryptedAccessToken?.startsWith("v1:")).toBe(true);
    expect(rawDbIntegration.encryptedAccessToken).not.toContain(
      "ya29.initial_persisted_access_token"
    );

    // Planned Key Rotation from v1 to v2 in PostgreSQL
    const rotated = await googleService.rotateIntegrationVaultKeyInPostgres({
      context: sess.context,
      integrationId: connected.id,
      targetKeyVersion: "v2",
    });
    expect(rotated.encryptionKeyVersion).toBe("v2");

    // Refresh Access Token using persisted encrypted refresh_token
    const refreshed = await googleService.refreshAccessTokenInPostgres({
      context: sess.context,
      integrationId: connected.id,
      clientId: "99887766-googleads.apps.googleusercontent.com",
      clientSecret: "GOCSPX-valid_client_secret",
      nowMs: 6_000_000,
      dnsResolver: publicDnsResolver,
      customPinnedExecutor: async () => ({
        statusCode: 200,
        headers: {},
        bodyText: JSON.stringify({
          access_token: "ya29.refreshed_access_token_v2",
          expires_in: 3600,
        }),
      }),
    });
    expect(refreshed.status).toBe("CONNECTED");

    // List Accessible Customers via Google Ads API v26 REST
    const customers = await googleService.listAccessibleCustomersViaRest({
      context: sess.context,
      integrationId: connected.id,
      dnsResolver: publicDnsResolver,
      customPinnedExecutor: async (req) => {
        expect(req.pathWithQuery).toBe(
          "/v26/customers:listAccessibleCustomers"
        );
        return {
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            resourceNames: ["customers/4028819001", "customers/4028819002"],
          }),
        };
      },
    });
    expect(customers).toEqual(["4028819001", "4028819002"]);

    // Execute paginated GAQL v26 search with transient 429 retry
    let gaqlCalls = 0;
    const gaqlRows = await googleService.executeReadOnlyGaqlSearchViaRest<{
      campaign: { id: string; name: string };
    }>({
      context: sess.context,
      integrationId: connected.id,
      customerId: "402-881-9001",
      gaqlQuery: "SELECT campaign.id, campaign.name FROM campaign",
      dnsResolver: publicDnsResolver,
      customPinnedExecutor: async (req) => {
        gaqlCalls += 1;
        expect(req.headers["login-customer-id"]).toBe("9901002000");
        if (gaqlCalls === 1) {
          return { statusCode: 429, headers: {}, bodyText: "Rate limit" };
        }
        return {
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            results: [{ campaign: { id: "9001", name: "Campanha Real GAQL" } }],
          }),
        };
      },
    });
    expect(gaqlRows).toHaveLength(1);
    expect(gaqlCalls).toBe(2);

    // Revoke Integration in PostgreSQL and confirm subsequent GAQL call fails
    const rev = await googleService.revokeIntegrationInPostgres({
      context: sess.context,
      integrationId: connected.id,
    });
    expect(rev.status).toBe("REVOKED");

    await expect(
      googleService.listAccessibleCustomersViaRest({
        context: sess.context,
        integrationId: connected.id,
        dnsResolver: publicDnsResolver,
      })
    ).rejects.toThrow(/has been revoked/);

    // SSRF Transport Guard: block unallowed host & block HTTP 302 redirect
    await expect(
      executePinnedHttpsRequest({
        url: "https://untrusted-domain.example.com/api",
        dnsResolver: publicDnsResolver,
      })
    ).rejects.toThrow(/not in the official allowed hosts list/);

    await expect(
      executePinnedHttpsRequest({
        url: "https://googleads.googleapis.com/v26/customers:listAccessibleCustomers",
        dnsResolver: publicDnsResolver,
        customPinnedExecutor: async () => ({
          statusCode: 302,
          headers: { location: "https://169.254.169.254/latest" },
          bodyText: "",
        }),
      })
    ).rejects.toThrow(/Unauthorized HTTP redirect/);
  });

  it("4. Persistent 9-Domain Synchronization, Concurrency Lock, Crash Recovery, Idempotent Re-run & Exact Aggregated Metrics", async () => {
    const org = await onboardFirstOrganizationRepository(db, {
      fullName: "Owner Sync",
      email: "sync.owner@konnexy.com.br",
      password: "PasswordSync#2026",
      organizationName: "Agencia Sync 9 Dominios",
      organizationSlug: "agencia-sync-9-dominios",
      timezone: "America/Sao_Paulo",
      currencyCode: "BRL",
    });
    const sess = await resolveSessionFromPostgres(db, {
      sessionToken: org.sessionToken,
    });
    const repo = new PersistentDrizzleTenantRepository(db);

    const client = await repo.createClient(sess.context, {
      name: "Clinica Sorriso Persistente",
      industry: "Odontologia",
      monthlyBudgetCapCents: 900_000,
      targetCpaCents: 3500,
    });

    const [integration] = await db
      .insert(schema.integrations)
      .values({
        organizationId: sess.context.organizationId,
        provider: "GOOGLE_ADS",
        externalAccountLabel: "Google Ads Sync Test",
        status: "CONNECTED",
        isDemoIntegration: false,
      })
      .returning();

    const syncEngine = new PersistentPostgresAdsSyncEngine(db);

    const buildBatch = (checkpoint: string, day1CostMicros: number) => ({
      checkpointToken: checkpoint,
      currencyCode: "BRL",
      timezone: "America/Sao_Paulo",
      isDemoData: false,
      adAccounts: [
        {
          externalAccountId: "4028819001",
          name: "Google Ads Clinica Sorriso",
          managerCustomerId: "9901002000",
        },
      ],
      campaigns: [
        {
          externalCampaignId: "GADS-CAMP-1",
          name: "Search Implantes",
          dailyBudgetMicros: 200_000_000,
        },
        {
          externalCampaignId: "GADS-CAMP-2",
          name: "Search Invisalign",
          dailyBudgetMicros: 150_000_000,
        },
      ],
      adGroups: [
        {
          externalAdGroupId: "AG-100",
          externalCampaignId: "GADS-CAMP-1",
          name: "Implante Carga Imediata",
          defaultCpcBidMicros: 3_500_000,
        },
      ],
      ads: [
        {
          externalAdId: "AD-200",
          externalAdGroupId: "AG-100",
          headlines: ["Implante Dentário SP", "Avaliação Especializada"],
          descriptions: ["Clínica Especializada Zona Sul"],
          finalUrl: "https://sorrisoprime.com.br/implantes",
        },
      ],
      keywords: [
        {
          externalKeywordId: "KW-300",
          externalAdGroupId: "AG-100",
          text: "implante dentario zona sul",
          matchType: "EXACT" as const,
          qualityScore: 9,
        },
      ],
      searchTerms: [
        {
          externalCampaignId: "GADS-CAMP-1",
          externalAdGroupId: "AG-100",
          searchTerm: "clinica implante dentario sp",
          impressions: 240,
          clicks: 24,
          costMicros: 72_000_000,
          conversions: 3,
          observedDate: "2026-11-25",
        },
      ],
      conversions: [
        {
          externalConversionId: "CONV-400",
          name: "Agendamento WhatsApp Confirmado",
          category: "LEAD",
          attributionModel: "DATA_DRIVEN",
        },
      ],
      dailyMetrics: [
        // Campaign 1: High volume (1000 impr, 100 clicks [10% CTR], R$ 200 cost, 10 conv [R$ 20 CPA], R$ 1200 value [6x ROAS])
        {
          externalCampaignId: "GADS-CAMP-1",
          metricDate: "2026-11-25",
          impressions: 1000,
          clicks: 100,
          costMicros: day1CostMicros,
          conversions: 10,
          conversionValueMicros: 1_200_000_000,
        },
        // Campaign 2: Low volume (100 impr, 2 clicks [2% CTR], R$ 100 cost, 2 conv [R$ 50 CPA], R$ 300 value [3x ROAS])
        {
          externalCampaignId: "GADS-CAMP-2",
          metricDate: "2026-11-26",
          impressions: 100,
          clicks: 2,
          costMicros: 100_000_000,
          conversions: 2,
          conversionValueMicros: 300_000_000,
        },
      ],
      budgets: [
        {
          periodMonth: "2026-11",
          allocatedMicros: 9_000_000_000,
          spentMicros: 300_000_000,
        },
      ],
    });

    const firstRun = await syncEngine.executePersistentSync({
      context: sess.context,
      integrationId: integration.id,
      clientId: client.id,
      provider: "GOOGLE_ADS",
      fetchBatchFn: async () => buildBatch("ckpt-v1", 200_000_000),
    });

    expect(firstRun.status).toBe("COMPLETED");
    expect(firstRun.checkpointToken).toBe("ckpt-v1");

    // Re-run idempotently with updated metric cost (reconciliation from R$ 200 to R$ 204)
    const secondRun = await syncEngine.executePersistentSync({
      context: sess.context,
      integrationId: integration.id,
      clientId: client.id,
      provider: "GOOGLE_ADS",
      fetchBatchFn: async (prevCkpt) => {
        expect(prevCkpt).toBe("ckpt-v1");
        return buildBatch("ckpt-v2", 204_000_000);
      },
    });
    expect(secondRun.status).toBe("COMPLETED");
    expect(secondRun.checkpointToken).toBe("ckpt-v2");

    // Verify all 9 domain tables were persisted without duplicate rows
    const orgFilter = sess.context.organizationId;
    const dbAccounts = await db
      .select()
      .from(schema.adAccounts)
      .where(eq(schema.adAccounts.organizationId, orgFilter));
    const dbCampaigns = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.organizationId, orgFilter));
    const dbAdGroups = await db
      .select()
      .from(schema.adGroups)
      .where(eq(schema.adGroups.organizationId, orgFilter));
    const dbAds = await db
      .select()
      .from(schema.ads)
      .where(eq(schema.ads.organizationId, orgFilter));
    const dbKeywords = await db
      .select()
      .from(schema.keywords)
      .where(eq(schema.keywords.organizationId, orgFilter));
    const dbSearchTerms = await db
      .select()
      .from(schema.searchTerms)
      .where(eq(schema.searchTerms.organizationId, orgFilter));
    const dbConversions = await db
      .select()
      .from(schema.conversions)
      .where(eq(schema.conversions.organizationId, orgFilter));
    const dbMetrics = await db
      .select()
      .from(schema.dailyMetrics)
      .where(eq(schema.dailyMetrics.organizationId, orgFilter));
    const dbBudgets = await db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.organizationId, orgFilter));

    expect(dbAccounts).toHaveLength(1);
    expect(dbCampaigns).toHaveLength(2);
    expect(dbAdGroups).toHaveLength(1);
    expect(dbAds).toHaveLength(1);
    expect(dbKeywords).toHaveLength(1);
    expect(dbSearchTerms).toHaveLength(1);
    expect(dbConversions).toHaveLength(1);
    expect(dbMetrics).toHaveLength(2);
    expect(dbBudgets).toHaveLength(1);

    // Verify Section 13 Invariant: Aggregated rates are calculated over totals (NOT simple average of rates)
    // Total impressions = 1100, Total clicks = 102 -> True CTR = (102/1100)*100 = 9.27% (whereas average of 10% and 2% would be 6.00%)
    // Total spend = R$ 304.00 (30400 cents), Total conversions = 12 -> True CPA = R$ 25.33 (2533 cents), Total conv value = R$ 1500 -> True ROAS = 4.93x
    const agg = await repo.getAggregatedDashboardMetrics(sess.context, {
      periodDays: 7,
      referenceDateIso: "2026-11-26",
    });

    expect(agg.hasData).toBe(true);
    expect(agg.totalSpendCents).toBe(30400);
    expect(agg.totalImpressions).toBe(1100);
    expect(agg.totalClicks).toBe(102);
    expect(agg.totalConversions).toBe(12);
    expect(agg.ctrPct).toBe(9.27);
    expect(agg.cpaCents).toBe(2533);
    expect(agg.cpcCents).toBe(298);
    expect(agg.roas).toBe(4.93);

    // Simulate a stale RUNNING sync job left behind by a crash and verify durable lock + recovery
    await db.insert(schema.syncRuns).values({
      organizationId: orgFilter,
      integrationId: integration.id,
      provider: "GOOGLE_ADS",
      status: "RUNNING",
      checkpointToken: "ckpt-stale",
    });

    const lockedAttempt = await syncEngine.executePersistentSync({
      context: sess.context,
      integrationId: integration.id,
      clientId: client.id,
      provider: "GOOGLE_ADS",
      fetchBatchFn: async () => buildBatch("ckpt-v3", 204_000_000),
    });
    expect(lockedAttempt.status).toBe("SKIPPED_CONCURRENT_LOCK");

    const recoveredCount = await syncEngine.recoverStaleRunningSyncs(
      sess.context,
      integration.id
    );
    expect(recoveredCount).toBe(1);
  });

  it("5. Neon Serverless Pool Transaction Protocol: Enforces SET LOCAL ROLE konnexy_app, set_config(organization_id, true) & pool.end()", async () => {
    const executedQueries: Array<{ text: string; values: unknown[] }> = [];
    let poolEnded = false;

    const testOrgId = "11111111-2222-4333-8444-555555555555";
    const mockContext = {
      organizationId: testOrgId,
      organizationSlug: "neon-protocol-test",
      userId: "99999999-8888-4777-8666-555555555555",
      role: "OWNER" as const,
      executionMode: "READ_ONLY" as const,
      emergencyStopActive: false,
    };

    const mockClient = {
      query: async (
        queryTextOrConfig: string | { text: string; values?: unknown[] },
        values?: unknown[]
      ) => {
        const text =
          typeof queryTextOrConfig === "string"
            ? queryTextOrConfig
            : queryTextOrConfig.text;
        const params = Array.isArray(values)
          ? values
          : typeof queryTextOrConfig === "object" &&
              Array.isArray(queryTextOrConfig.values)
            ? queryTextOrConfig.values
            : [];
        executedQueries.push({ text, values: params });
        return { rows: [], rowCount: 0, fields: [] };
      },
      release: () => undefined,
    };

    const mockNeonPool = {
      connect: async () => mockClient,
      query: mockClient.query,
      end: async () => {
        poolEnded = true;
      },
    };

    const result = await withTenantTransaction(
      mockContext,
      async () => {
        return "NEON_TX_OK";
      },
      {
        connectionString:
          "postgresql://neondb_owner:secret@ep-konnexy-pooler.sa-east-1.aws.neon.tech/konnexy_ads?sslmode=require",
        forceNeonDriver: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        neonPoolFactory: () => mockNeonPool as any,
      }
    );

    expect(result).toBe("NEON_TX_OK");
    expect(poolEnded).toBe(true);

    const queryTexts = executedQueries.map((q) => q.text.trim().toLowerCase());
    expect(queryTexts[0]?.startsWith("begin")).toBe(true);
    expect(
      queryTexts.some((q) => q.includes("set local role konnexy_app"))
    ).toBe(true);
    const setConfigCall = executedQueries.find((q) =>
      q.text.toLowerCase().includes("set_config")
    );
    expect(setConfigCall).toBeDefined();
    expect(setConfigCall?.values).toContain(testOrgId);
    expect(queryTexts[queryTexts.length - 1]?.startsWith("commit")).toBe(true);
  });
});
