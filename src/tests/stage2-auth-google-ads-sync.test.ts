import { describe, it, expect } from "vitest";
import type { TenantContext } from "@/domain/types";
import {
  AuthAbuseRateLimiter,
  hashPasswordScrypt,
  verifyPasswordScrypt,
} from "@/security/auth-rate-limiter";
import {
  resolveAuthoritativeTenantContext,
  UnauthenticatedAccessError,
  type ServerMembershipRecord,
  type ServerSessionToken,
} from "@/security/session-guard";
import {
  PermissionDeniedError,
  TenantIsolationError,
} from "@/security/rbac-and-tenant";
import {
  createGoogleAdsOAuthAuthorizationRequest,
  verifyGoogleAdsOAuthState,
  convertGoogleAdsMicrosToCents,
  normalizeGoogleAdsCustomerId,
  buildGoogleAdsReadOnlyHeaders,
  GoogleAdsReadOnlyIntegrationService,
} from "@/integrations/google-ads/google-ads-oauth-and-readonly";
import { ProviderIntegrationError } from "@/integrations/contracts/advertising-provider";
import { IncrementalAdsSyncEngine } from "@/workflows/incremental-sync-engine";

const ORG_ALPHA_CTX: TenantContext = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationSlug: "alpha-agency",
  userId: "user-owner-alpha",
  role: "OWNER",
  executionMode: "READ_ONLY",
  emergencyStopActive: false,
};

const ORG_BETA_CTX: TenantContext = {
  organizationId: "22222222-2222-4222-8222-222222222222",
  organizationSlug: "beta-agency",
  userId: "user-owner-beta",
  role: "OWNER",
  executionMode: "READ_ONLY",
  emergencyStopActive: false,
};

const VALID_KEY_RING = {
  v1: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
};

describe("Stage 2 — Phase 2: Authentication Session Guard, Spoofing Prevention & Rate Limiting", () => {
  const validSession: ServerSessionToken = {
    sessionId: "sess-01",
    userId: "user-owner-alpha",
    email: "owner@alpha.com.br",
    fullName: "Owner Alpha",
    issuedAtMs: 1_000_000,
    expiresAtMs: 2_000_000,
  };

  const memberships: readonly ServerMembershipRecord[] = [
    {
      id: "mem-1",
      organizationId: ORG_ALPHA_CTX.organizationId,
      organizationSlug: "alpha-agency",
      organizationName: "Alpha Agency",
      userId: "user-owner-alpha",
      role: "ANALYST",
      executionMode: "READ_ONLY",
      emergencyStopActive: false,
    },
  ];

  it("blocks unauthenticated or expired sessions with UnauthenticatedAccessError", () => {
    expect(() =>
      resolveAuthoritativeTenantContext({
        session: null,
        requestedOrganizationId: ORG_ALPHA_CTX.organizationId,
        serverMemberships: memberships,
      })
    ).toThrow(UnauthenticatedAccessError);

    expect(() =>
      resolveAuthoritativeTenantContext({
        session: validSession,
        requestedOrganizationId: ORG_ALPHA_CTX.organizationId,
        serverMemberships: memberships,
        nowMs: 2_500_000, // expired
      })
    ).toThrow(/has expired/);
  });

  it("never trusts browser-supplied role or userId and blocks cross-organization access", () => {
    // Client attempts to spoof role = OWNER when server membership is ANALYST
    const resolved = resolveAuthoritativeTenantContext({
      session: validSession,
      requestedOrganizationId: ORG_ALPHA_CTX.organizationId,
      serverMemberships: memberships,
      untrustedClientClaims: {
        role: "OWNER",
      },
      nowMs: 1_500_000,
    });
    expect(resolved.role).toBe("ANALYST");

    // Client attempts to spoof another userId
    expect(() =>
      resolveAuthoritativeTenantContext({
        session: validSession,
        requestedOrganizationId: ORG_ALPHA_CTX.organizationId,
        serverMemberships: memberships,
        untrustedClientClaims: {
          userId: "another-user-id",
        },
        nowMs: 1_500_000,
      })
    ).toThrow(PermissionDeniedError);

    // Client attempts to access ORG_BETA where user has no membership
    expect(() =>
      resolveAuthoritativeTenantContext({
        session: validSession,
        requestedOrganizationId: ORG_BETA_CTX.organizationId,
        serverMemberships: memberships,
        nowMs: 1_500_000,
      })
    ).toThrow(TenantIsolationError);
  });

  it("enforces authentication rate limiting lockout and verifies scrypt password hashes", () => {
    const limiter = new AuthAbuseRateLimiter(3, 60_000, 120_000);
    const id = "attacker@example.com";

    expect(limiter.checkAllowed(id, 1000).allowed).toBe(true);
    limiter.recordFailedAttempt(id, 1000);
    limiter.recordFailedAttempt(id, 2000);
    const third = limiter.recordFailedAttempt(id, 3000);
    expect(third.locked).toBe(true);

    const blocked = limiter.checkAllowed(id, 4000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    const hash = hashPasswordScrypt("StrongPass#2026");
    expect(verifyPasswordScrypt("StrongPass#2026", hash)).toBe(true);
    expect(verifyPasswordScrypt("WrongPass", hash)).toBe(false);
  });
});

describe("Stage 2 — Phase 5: Google Ads OAuth 2.0, Mandatory AAD Vault, MCC, Revocation & Read-Only Guard", () => {
  const signingSecret = "oauth-state-hmac-secret-32-bytes-minimum-key";

  it("creates and verifies PKCE S256 + HMAC-signed OAuth state and rejects cross-tenant or expired state", () => {
    const req = createGoogleAdsOAuthAuthorizationRequest({
      context: ORG_ALPHA_CTX,
      clientId: "1234567890-validclient.apps.googleusercontent.com",
      redirectUri: "https://ads.konnexy.com.br/api/integrations/google-ads/callback",
      stateSigningSecret: signingSecret,
      nowMs: 1_000_000,
    });

    expect(req.authorizationUrl).toContain("code_challenge_method=S256");
    expect(req.codeVerifier.length).toBeGreaterThan(30);

    const verified = verifyGoogleAdsOAuthState({
      context: ORG_ALPHA_CTX,
      signedState: req.signedState,
      stateSigningSecret: signingSecret,
      nowMs: 1_200_000,
    });
    expect(verified.organizationId).toBe(ORG_ALPHA_CTX.organizationId);

    // Expired state after 15 minutes
    expect(() =>
      verifyGoogleAdsOAuthState({
        context: ORG_ALPHA_CTX,
        signedState: req.signedState,
        stateSigningSecret: signingSecret,
        nowMs: 1_000_000 + 15 * 60 * 1000,
      })
    ).toThrow(/has expired/);

    // Cross-tenant attempt using ORG_BETA_CTX
    expect(() =>
      verifyGoogleAdsOAuthState({
        context: ORG_BETA_CTX,
        signedState: req.signedState,
        stateSigningSecret: signingSecret,
        nowMs: 1_200_000,
      })
    ).toThrow(TenantIsolationError);
  });

  it("stores OAuth tokens with mandatory AAD, selects MCC accounts, revokes credentials, and blocks mutation GAQL", async () => {
    const service = new GoogleAdsReadOnlyIntegrationService(VALID_KEY_RING);
    const integrationId = "int-gads-alpha-01";

    const metadata = service.storeAuthorizedTokens({
      context: ORG_ALPHA_CTX,
      integrationId,
      accessToken: "ya29.live_access_token_alpha",
      refreshToken: "1//0live_refresh_token_alpha",
      expiresInSeconds: 3600,
      managerCustomerId: "990-100-2000",
      discoveredAccounts: [
        {
          customerId: "402-881-9001",
          descriptiveName: "Sorriso Prime SP",
          currencyCode: "BRL",
          timeZone: "America/Sao_Paulo",
          isManagerMcc: false,
          managerCustomerId: "990-100-2000",
          isSelectedForSync: false,
        },
        {
          customerId: "402-881-9002",
          descriptiveName: "CFC Via Rápida",
          currencyCode: "BRL",
          timeZone: "America/Sao_Paulo",
          isManagerMcc: false,
          managerCustomerId: "990-100-2000",
          isSelectedForSync: false,
        },
      ],
    });

    // Metadata returned to application layer NEVER contains raw or encrypted tokens
    expect("encryptedAccessToken" in metadata).toBe(false);
    expect(metadata.managerCustomerId).toBe("9901002000");

    // Select only account 402-881-9001 for synchronization
    const updatedAccounts = service.selectAuthorizedAccounts({
      context: ORG_ALPHA_CTX,
      integrationId,
      selectedCustomerIds: ["402-881-9001"],
    });
    expect(updatedAccounts[0]?.isSelectedForSync).toBe(true);
    expect(updatedAccounts[1]?.isSelectedForSync).toBe(false);

    // Build headers with MCC login-customer-id
    const headers = buildGoogleAdsReadOnlyHeaders({
      accessToken: "ya29.token",
      developerToken: "dev-token-valid-12345",
      managerCustomerId: "990-100-2000",
    });
    expect(headers["login-customer-id"]).toBe("9901002000");

    // Paginated read-only GAQL query with retry on transient 429 error
    let callCount = 0;
    const rows = await service.executeReadOnlyGaqlQuery<{ id: string }>({
      context: ORG_ALPHA_CTX,
      integrationId,
      customerId: "402-881-9001",
      gaqlQuery: "SELECT campaign.id, campaign.name FROM campaign",
      transportFn: async ({ pageToken }) => {
        callCount += 1;
        if (callCount === 1) {
          throw new ProviderIntegrationError(
            "GOOGLE_ADS",
            "RATE_LIMIT_EXCEEDED",
            true,
            "Transient 429"
          );
        }
        if (!pageToken) {
          return {
            results: [{ id: "camp-1" }],
            nextPageToken: "page-2-token",
          };
        }
        return {
          results: [{ id: "camp-2" }],
        };
      },
    });
    expect(rows).toEqual([{ id: "camp-1" }, { id: "camp-2" }]);

    // Strictly block any non-SELECT or mutation GAQL query
    await expect(
      service.executeReadOnlyGaqlQuery({
        context: ORG_ALPHA_CTX,
        integrationId,
        customerId: "402-881-9001",
        gaqlQuery: "MUTATE campaign SET status = PAUSED",
        transportFn: async () => ({ results: [] }),
      })
    ).rejects.toThrow(/strictly enforces READ_ONLY/);

    // Revoke integration and verify subsequent token resolution / query is blocked
    const revoked = service.revokeIntegration({
      context: ORG_ALPHA_CTX,
      integrationId,
    });
    expect(revoked.status).toBe("REVOKED");

    await expect(
      service.executeReadOnlyGaqlQuery({
        context: ORG_ALPHA_CTX,
        integrationId,
        customerId: "402-881-9001",
        gaqlQuery: "SELECT campaign.id FROM campaign",
        transportFn: async () => ({ results: [] }),
      })
    ).rejects.toThrow(/has been revoked/);
  });
});

describe("Stage 2 — Phase 6: Incremental, Idempotent & Concurrent Synchronization Engine", () => {
  it("normalizes Google Ads micros to exact cents, preserves checkpoints, and prevents concurrent duplicate syncs", async () => {
    expect(convertGoogleAdsMicrosToCents(148_050_000)).toBe(14805);
    expect(normalizeGoogleAdsCustomerId("402-881-9001")).toBe("4028819001");

    const syncEngine = new IncrementalAdsSyncEngine();

    const createSlowFetchBatch = () => async () => {
      await new Promise((r) => setTimeout(r, 25));
      return {
        checkpointToken: "ckpt-2026-11-26-001",
        currencyCode: "BRL",
        timezone: "America/Sao_Paulo",
        isDemoData: false,
        adAccounts: [{ externalAccountId: "4028819001", name: "Sorriso Prime" }],
        campaigns: [
          {
            externalCampaignId: "camp-101",
            name: "Search Implantes",
            dailyBudgetMicros: 220_000_000, // R$ 220.00 -> 22000 cents
          },
        ],
        adGroups: [
          {
            externalAdGroupId: "ag-1",
            externalCampaignId: "camp-101",
            name: "Implante Unitario",
          },
        ],
        ads: [
          {
            externalAdId: "ad-1",
            externalAdGroupId: "ag-1",
            finalUrl: "https://sorrisoprime.com.br",
          },
        ],
        keywords: [
          {
            externalKeywordId: "kw-1",
            text: "implante dentario sp",
            matchType: "EXACT" as const,
          },
        ],
        searchTerms: [
          {
            searchTerm: "implante dentario zona sul sp",
            costMicros: 15_500_000,
            observedDate: "2026-11-26",
          },
        ],
        conversions: [
          {
            externalConversionId: "conv-1",
            name: "Lead WhatsApp Qualificado",
          },
        ],
        dailyMetrics: [
          {
            externalCampaignId: "camp-101",
            metricDate: "2026-11-26",
            impressions: 1000,
            clicks: 50,
            costMicros: 150_000_000, // R$ 150.00 -> 15000 cents
            conversions: 5,
            conversionValueMicros: 900_000_000, // R$ 900.00 -> 90000 cents
          },
        ],
        budgets: [
          {
            periodMonth: "2026-11",
            allocatedMicros: 6_000_000_000,
            spentMicros: 150_000_000,
          },
        ],
      };
    };

    // Run two concurrent syncs for the exact same organization + adAccount
    const [run1, run2] = await Promise.all([
      syncEngine.runIncrementalSync({
        context: ORG_ALPHA_CTX,
        integrationId: "int-gads-01",
        adAccountId: "acc-4028819001",
        provider: "GOOGLE_ADS",
        fetchBatchFn: createSlowFetchBatch(),
      }),
      syncEngine.runIncrementalSync({
        context: ORG_ALPHA_CTX,
        integrationId: "int-gads-01",
        adAccountId: "acc-4028819001",
        provider: "GOOGLE_ADS",
        fetchBatchFn: createSlowFetchBatch(),
      }),
    ]);

    const statuses = [run1.status, run2.status].sort();
    expect(statuses).toEqual(["COMPLETED", "SKIPPED_CONCURRENT_LOCK"]);

    expect(
      syncEngine.getLastCheckpoint(
        ORG_ALPHA_CTX.organizationId,
        "acc-4028819001"
      )
    ).toBe("ckpt-2026-11-26-001");

    const metrics = syncEngine.getSyncedDailyMetrics(ORG_ALPHA_CTX);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.costCents).toBe(15000);
    expect(metrics[0]?.ctrPct).toBe(5); // 50 / 1000 = 5%
    expect(metrics[0]?.cpcCents).toBe(300); // 15000 / 50 = 300 cents (R$ 3.00)
    expect(metrics[0]?.cpaCents).toBe(3000); // 15000 / 5 = 3000 cents (R$ 30.00)
    expect(metrics[0]?.roas).toBe(6); // 90000 / 15000 = 6.0x
  });
});
