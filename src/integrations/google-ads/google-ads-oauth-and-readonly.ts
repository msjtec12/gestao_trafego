import crypto from "crypto";
import type { TenantContext } from "@/domain/types";
import {
  assertPermission,
  assertTenantAccess,
} from "@/security/rbac-and-tenant";
import {
  decryptVaultCredentialWithMandatoryAad,
  encryptVaultCredentialWithMandatoryAad,
  type KeyRing,
} from "@/security/vault-and-guards";
import { ProviderIntegrationError } from "@/integrations/contracts/advertising-provider";

export const GOOGLE_ADS_OAUTH_SCOPE = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_ADS_API_VERSION = "v19";

export interface GoogleAdsCustomerAccount {
  readonly customerId: string; // e.g., "1234567890" (no hyphens)
  readonly descriptiveName: string;
  readonly currencyCode: string;
  readonly timeZone: string;
  readonly isManagerMcc: boolean;
  readonly managerCustomerId: string | null;
  readonly isSelectedForSync: boolean;
}

export interface StoredGoogleAdsIntegrationVaultRecord {
  readonly integrationId: string;
  readonly organizationId: string;
  readonly provider: "GOOGLE_ADS";
  readonly status: "CONNECTED" | "EXPIRED" | "REVOKED" | "ERROR";
  readonly managerCustomerId: string | null;
  readonly encryptedAccessToken: string | null;
  readonly encryptedRefreshToken: string | null;
  readonly encryptionKeyVersion: string;
  readonly tokenExpiresAtIso: string | null;
  readonly scopes: readonly string[];
  readonly authorizedAccounts: readonly GoogleAdsCustomerAccount[];
  readonly lastSyncedAtIso: string | null;
  readonly revokedAtIso: string | null;
}

export interface OAuthStatePayload {
  readonly organizationId: string;
  readonly userId: string;
  readonly nonce: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly codeChallenge: string;
}

/**
 * Generates PKCE (S256) verifier & challenge + HMAC-SHA256 signed OAuth 2.0 state
 * bound to the authenticated tenant session to prevent CSRF and authorization code injection.
 */
export function createGoogleAdsOAuthAuthorizationRequest(params: {
  readonly context: TenantContext;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly stateSigningSecret: string;
  readonly nowMs?: number;
}): {
  readonly authorizationUrl: string;
  readonly signedState: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
} {
  const {
    context,
    clientId,
    redirectUri,
    stateSigningSecret,
    nowMs = Date.now(),
  } = params;

  assertPermission(context, "integrations:manage");

  if (!clientId?.trim() || clientId.startsWith("replace_with_")) {
    throw new ProviderIntegrationError(
      "GOOGLE_ADS",
      "NOT_CONFIGURED_IN_FOUNDATION",
      false,
      "GOOGLE_ADS_CLIENT_ID is not configured with official Google Cloud credentials."
    );
  }

  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const payload: OAuthStatePayload = {
    organizationId: context.organizationId,
    userId: context.userId,
    nonce: crypto.randomBytes(16).toString("hex"),
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 10 * 60 * 1000, // 10 minutes strict OAuth window
    codeChallenge,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = crypto
    .createHmac("sha256", stateSigningSecret)
    .update(encodedPayload)
    .digest("base64url");
  const signedState = `${encodedPayload}.${signature}`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId.trim());
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_ADS_OAUTH_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", signedState);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  return {
    authorizationUrl: authUrl.toString(),
    signedState,
    codeVerifier,
    codeChallenge,
  };
}

export function verifyGoogleAdsOAuthState(params: {
  readonly context: TenantContext;
  readonly signedState: string;
  readonly stateSigningSecret: string;
  readonly nowMs?: number;
}): OAuthStatePayload {
  const {
    context,
    signedState,
    stateSigningSecret,
    nowMs = Date.now(),
  } = params;

  assertPermission(context, "integrations:manage");

  const parts = signedState.split(".");
  if (parts.length !== 2) {
    throw new Error("OAuth State Error: Malformed state token.");
  }

  const [encodedPayload, providedSig] = parts;
  if (!encodedPayload || !providedSig) {
    throw new Error("OAuth State Error: Missing state components.");
  }

  const expectedSig = crypto
    .createHmac("sha256", stateSigningSecret)
    .update(encodedPayload)
    .digest("base64url");

  const bufA = Buffer.from(providedSig, "utf8");
  const bufB = Buffer.from(expectedSig, "utf8");
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    throw new Error("OAuth State Error: Invalid HMAC signature.");
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8")
  ) as OAuthStatePayload;

  if (payload.expiresAtMs <= nowMs) {
    throw new Error("OAuth State Error: Authorization state has expired.");
  }

  assertTenantAccess(context, payload.organizationId);
  if (payload.userId !== context.userId) {
    throw new Error(
      "OAuth State Error: State userId does not match authenticated session user."
    );
  }

  return payload;
}

/**
 * Converts Google Ads API `cost_micros` (1 unit = 1,000,000 micros) into exact integer cents.
 */
export function convertGoogleAdsMicrosToCents(costMicros: number | string): number {
  const numericMicros =
    typeof costMicros === "string" ? Number(costMicros) : costMicros;
  if (!Number.isFinite(numericMicros) || numericMicros < 0) {
    throw new Error(`Invalid Google Ads cost_micros value: '${costMicros}'.`);
  }
  return Math.round(numericMicros / 10_000);
}

/**
 * Normalizes a 10-digit Google Ads Customer ID (e.g. "123-456-7890" -> "1234567890").
 */
export function normalizeGoogleAdsCustomerId(rawCustomerId: string): string {
  const digits = rawCustomerId.replace(/-/g, "").trim();
  if (!/^\d{10}$/.test(digits)) {
    throw new Error(
      `Invalid Google Ads Customer ID '${rawCustomerId}': must contain exactly 10 digits.`
    );
  }
  return digits;
}

/**
 * Builds standard Google Ads REST API headers including `login-customer-id` when querying
 * a client account through an MCC (Manager Account).
 */
export function buildGoogleAdsReadOnlyHeaders(params: {
  readonly accessToken: string;
  readonly developerToken: string;
  readonly managerCustomerId?: string | null;
}): Record<string, string> {
  if (!params.developerToken?.trim() || params.developerToken.startsWith("replace_with_")) {
    throw new ProviderIntegrationError(
      "GOOGLE_ADS",
      "NOT_CONFIGURED_IN_FOUNDATION",
      false,
      "GOOGLE_ADS_DEVELOPER_TOKEN is not configured."
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.accessToken}`,
    "developer-token": params.developerToken.trim(),
    "Content-Type": "application/json",
  };

  if (params.managerCustomerId) {
    headers["login-customer-id"] = normalizeGoogleAdsCustomerId(
      params.managerCustomerId
    );
  }

  return headers;
}

/**
 * Manages Google Ads OAuth credentials inside the AES-256-GCM Credential Vault
 * with mandatory tenant+integration AAD binding, account selection, revocation,
 * and strict READ_ONLY enforcement.
 */
export class GoogleAdsReadOnlyIntegrationService {
  private readonly vaultStore = new Map<
    string,
    StoredGoogleAdsIntegrationVaultRecord
  >();

  constructor(
    private readonly keyRing: string | KeyRing,
    private readonly activeKeyVersion = "v1"
  ) {}

  private compositeKey(organizationId: string, integrationId: string): string {
    return `${organizationId}:${integrationId}`;
  }

  public storeAuthorizedTokens(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly expiresInSeconds: number;
    readonly managerCustomerId?: string | null;
    readonly discoveredAccounts: readonly GoogleAdsCustomerAccount[];
    readonly nowMs?: number;
  }): Omit<
    StoredGoogleAdsIntegrationVaultRecord,
    "encryptedAccessToken" | "encryptedRefreshToken"
  > {
    const {
      context,
      integrationId,
      accessToken,
      refreshToken,
      expiresInSeconds,
      managerCustomerId = null,
      discoveredAccounts,
      nowMs = Date.now(),
    } = params;

    assertPermission(context, "integrations:manage");

    const aad = {
      organizationId: context.organizationId,
      integrationId,
    };

    const encryptedAccessToken = encryptVaultCredentialWithMandatoryAad({
      plainText: accessToken,
      keyRing: this.keyRing,
      keyVersion: this.activeKeyVersion,
      aad,
    });

    const encryptedRefreshToken = encryptVaultCredentialWithMandatoryAad({
      plainText: refreshToken,
      keyRing: this.keyRing,
      keyVersion: this.activeKeyVersion,
      aad,
    });

    const record: StoredGoogleAdsIntegrationVaultRecord = {
      integrationId,
      organizationId: context.organizationId,
      provider: "GOOGLE_ADS",
      status: "CONNECTED",
      managerCustomerId: managerCustomerId
        ? normalizeGoogleAdsCustomerId(managerCustomerId)
        : null,
      encryptedAccessToken,
      encryptedRefreshToken,
      encryptionKeyVersion: this.activeKeyVersion,
      tokenExpiresAtIso: new Date(
        nowMs + expiresInSeconds * 1000
      ).toISOString(),
      scopes: [GOOGLE_ADS_OAUTH_SCOPE],
      authorizedAccounts: discoveredAccounts.map((acc) => ({
        ...acc,
        customerId: normalizeGoogleAdsCustomerId(acc.customerId),
      })),
      lastSyncedAtIso: null,
      revokedAtIso: null,
    };

    this.vaultStore.set(
      this.compositeKey(context.organizationId, integrationId),
      record
    );

    // NEVER return encrypted or plain tokens to caller/UI
    const {
      encryptedAccessToken: _eat,
      encryptedRefreshToken: _ert,
      ...safePublicMetadata
    } = record;
    void _eat;
    void _ert;
    return safePublicMetadata;
  }

  public selectAuthorizedAccounts(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly selectedCustomerIds: readonly string[];
  }): readonly GoogleAdsCustomerAccount[] {
    const { context, integrationId, selectedCustomerIds } = params;
    assertPermission(context, "integrations:manage");

    const key = this.compositeKey(context.organizationId, integrationId);
    const existing = this.vaultStore.get(key);
    if (!existing) {
      throw new Error(`Integration '${integrationId}' not found for tenant.`);
    }
    assertTenantAccess(context, existing.organizationId);

    const normalizedSelected = new Set(
      selectedCustomerIds.map((id) => normalizeGoogleAdsCustomerId(id))
    );

    const updatedAccounts = existing.authorizedAccounts.map((acc) => ({
      ...acc,
      isSelectedForSync: normalizedSelected.has(acc.customerId),
    }));

    this.vaultStore.set(key, {
      ...existing,
      authorizedAccounts: updatedAccounts,
    });

    return updatedAccounts;
  }

  public revokeIntegration(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly nowMs?: number;
  }): {
    readonly integrationId: string;
    readonly status: "REVOKED";
    readonly revokedAtIso: string;
  } {
    const { context, integrationId, nowMs = Date.now() } = params;
    assertPermission(context, "integrations:manage");

    const key = this.compositeKey(context.organizationId, integrationId);
    const existing = this.vaultStore.get(key);
    if (!existing) {
      throw new Error(`Integration '${integrationId}' not found for tenant.`);
    }
    assertTenantAccess(context, existing.organizationId);

    const revokedAtIso = new Date(nowMs).toISOString();
    this.vaultStore.set(key, {
      ...existing,
      status: "REVOKED",
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      tokenExpiresAtIso: null,
      revokedAtIso,
    });

    return {
      integrationId,
      status: "REVOKED",
      revokedAtIso,
    };
  }

  /**
   * Internal server-only token resolution with AAD check.
   * Throws AUTH_TOKEN_REVOKED if integration was revoked.
   */
  public resolveDecryptedAccessTokenForServerSync(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
  }): string {
    const { context, integrationId } = params;
    const key = this.compositeKey(context.organizationId, integrationId);
    const existing = this.vaultStore.get(key);
    if (!existing) {
      throw new Error(`Integration '${integrationId}' not found for tenant.`);
    }
    assertTenantAccess(context, existing.organizationId);

    if (
      existing.status === "REVOKED" ||
      !existing.encryptedAccessToken
    ) {
      throw new ProviderIntegrationError(
        "GOOGLE_ADS",
        "AUTH_TOKEN_REVOKED",
        false,
        `Google Ads integration '${integrationId}' has been revoked and cannot be used.`
      );
    }

    return decryptVaultCredentialWithMandatoryAad({
      cipherPayload: existing.encryptedAccessToken,
      keyRing: this.keyRing,
      aad: {
        organizationId: context.organizationId,
        integrationId,
      },
    });
  }

  /**
   * Executes a paginated, retry-protected, strictly READ-ONLY GAQL query (`googleAds:search`).
   * Rejects any GAQL query or endpoint attempting mutations.
   */
  public async executeReadOnlyGaqlQuery<T>(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly customerId: string;
    readonly gaqlQuery: string;
    readonly pageSize?: number;
    readonly maxPages?: number;
    readonly transportFn: (req: {
      readonly customerId: string;
      readonly query: string;
      readonly pageToken?: string;
      readonly pageSize: number;
    }) => Promise<{
      readonly results: readonly T[];
      readonly nextPageToken?: string;
    }>;
  }): Promise<T[]> {
    const {
      context,
      integrationId,
      customerId,
      gaqlQuery,
      pageSize = 500,
      maxPages = 10,
      transportFn,
    } = params;

    assertTenantAccess(context, context.organizationId);

    // Ensure GAQL is strictly SELECT and contains no mutation keywords
    const trimmedQuery = gaqlQuery.trim();
    if (
      !/^SELECT\s+/i.test(trimmedQuery) ||
      /\b(MUTATE|INSERT|UPDATE|DELETE|REMOVE|CREATE)\b/i.test(trimmedQuery)
    ) {
      throw new ProviderIntegrationError(
        "GOOGLE_ADS",
        "POLICY_VIOLATION",
        false,
        "GoogleAdsReadOnlyIntegrationService strictly enforces READ_ONLY SELECT GAQL queries."
      );
    }

    // Verify integration is active and not revoked
    this.resolveDecryptedAccessTokenForServerSync({
      context,
      integrationId,
    });

    const normalizedCustomer = normalizeGoogleAdsCustomerId(customerId);
    const aggregated: T[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      pageCount += 1;
      let attempt = 0;
      const maxAttempts = 3;

      while (true) {
        try {
          const response = await transportFn({
            customerId: normalizedCustomer,
            query: trimmedQuery,
            pageToken,
            pageSize,
          });
          aggregated.push(...response.results);
          pageToken = response.nextPageToken;
          break;
        } catch (err) {
          attempt += 1;
          const isRetryable =
            err instanceof ProviderIntegrationError && err.retryable;
          if (!isRetryable || attempt >= maxAttempts) {
            throw err;
          }
        }
      }
    } while (pageToken && pageCount < maxPages);

    return aggregated;
  }
}
