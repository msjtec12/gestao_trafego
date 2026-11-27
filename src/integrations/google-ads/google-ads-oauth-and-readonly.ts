import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import type { TenantContext } from "@/domain/types";
import type { DrizzleQueryExecutor } from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";
import {
  assertPermission,
  assertTenantAccess,
} from "@/security/rbac-and-tenant";
import {
  decryptVaultCredentialWithMandatoryAad,
  encryptVaultCredentialWithMandatoryAad,
  rotateVaultCredentialKeyVersion,
  type KeyRing,
} from "@/security/vault-and-guards";
import {
  executePinnedHttpsRequest,
  type PinnedHttpsRequestOptions,
} from "@/security/secure-http-transport";
import { ProviderIntegrationError } from "@/integrations/contracts/advertising-provider";

export const GOOGLE_ADS_OAUTH_SCOPE = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_ADS_API_VERSION = "v26";

export interface GoogleAdsCustomerAccount {
  readonly customerId: string;
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

export function createGoogleAdsOAuthAuthorizationRequest(params: {
  readonly context: TenantContext;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly stateSigningSecret: string;
  readonly nowMs?: number;
}): {
  readonly authorizationUrl: string;
  readonly signedState: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly expiresAtMs: number;
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
  const nonce = crypto.randomBytes(24).toString("hex");
  const expiresAtMs = nowMs + 10 * 60 * 1000;

  const payload: OAuthStatePayload = {
    organizationId: context.organizationId,
    userId: context.userId,
    nonce,
    issuedAtMs: nowMs,
    expiresAtMs,
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
    nonce,
    codeVerifier,
    codeChallenge,
    expiresAtMs,
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

export function convertGoogleAdsMicrosToCents(
  costMicros: number | string
): number {
  const numericMicros =
    typeof costMicros === "string" ? Number(costMicros) : costMicros;
  if (!Number.isFinite(numericMicros) || numericMicros < 0) {
    throw new Error(`Invalid Google Ads cost_micros value: '${costMicros}'.`);
  }
  return Math.round(numericMicros / 10_000);
}

export function normalizeGoogleAdsCustomerId(rawCustomerId: string): string {
  const digits = rawCustomerId
    .replace(/^customers\//i, "")
    .replace(/-/g, "")
    .trim();
  if (!/^\d{10}$/.test(digits)) {
    throw new Error(
      `Invalid Google Ads Customer ID '${rawCustomerId}': must contain exactly 10 digits.`
    );
  }
  return digits;
}

/**
 * Dedicated error raised when Google Ads API rejects a production account request
 * because the linked Google Cloud project only has Test Access
 * (`AuthorizationError.CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`, Google Ads API Sep 9, 2026 policy).
 */
export class GoogleAdsCloudProjectApprovalError extends Error {
  public readonly errorCode = "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION";
  public readonly statusCode = 403;

  constructor(
    message = "O projeto Google Cloud vinculado às credenciais OAuth possui apenas Acesso de Teste na Google Ads API. Solicite aprovação de produção no Google Cloud Console (Google Ads API Overview) ou utilize uma conta de teste do Google Ads."
  ) {
    super(message);
    this.name = "GoogleAdsCloudProjectApprovalError";
  }
}

export function isCloudProjectNotApprovedForProductionError(
  responseBody: string
): boolean {
  return responseBody.includes("CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION");
}

/**
 * Builds official Google Ads API v26 READ_ONLY REST headers.
 * Per the September 9, 2026 official Google Ads API update, authorization and access level
 * are linked directly to the Google Cloud project via OAuth 2.0 (`Authorization: Bearer ...`).
 * `GOOGLE_ADS_DEVELOPER_TOKEN` is NO LONGER required and is omitted unless an explicit
 * non-placeholder legacy token is supplied.
 */
export function buildGoogleAdsReadOnlyHeaders(params: {
  readonly accessToken: string;
  readonly developerToken?: string | null;
  readonly managerCustomerId?: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.accessToken}`,
    "Content-Type": "application/json",
  };

  if (
    params.developerToken &&
    params.developerToken.trim() !== "" &&
    !params.developerToken.trim().startsWith("replace_with_")
  ) {
    headers["developer-token"] = params.developerToken.trim();
  }

  if (params.managerCustomerId) {
    headers["login-customer-id"] = normalizeGoogleAdsCustomerId(
      params.managerCustomerId
    );
  }

  return headers;
}

/**
 * Persistent PostgreSQL Google Ads OAuth 2.0 & Credential Vault Service.
 * - Persists single-use OAuth states in `oauth_states`.
 * - Exchanges authorization code for tokens via `executePinnedHttpsRequest`.
 * - Persists AES-256-GCM encrypted tokens with mandatory AAD (`organizationId + integrationId`) in `integrations`.
 * - Supports key rotation, token refresh, revocation, `customers:listAccessibleCustomers` and `googleAds:search` (v26).
 */
export class PersistentPostgresGoogleAdsService {
  constructor(
    private readonly db: DrizzleQueryExecutor,
    private readonly keyRing: string | KeyRing,
    private readonly activeKeyVersion = "v1"
  ) {}

  public async initiatePersistentOAuth(params: {
    readonly context: TenantContext;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly stateSigningSecret: string;
    readonly nowMs?: number;
  }): Promise<{
    readonly authorizationUrl: string;
    readonly signedState: string;
    readonly nonce: string;
  }> {
    const req = createGoogleAdsOAuthAuthorizationRequest(params);

    await this.db.insert(schema.oauthStates).values({
      nonce: req.nonce,
      organizationId: params.context.organizationId,
      userId: params.context.userId,
      provider: "GOOGLE_ADS",
      codeVerifier: req.codeVerifier,
      redirectUri: params.redirectUri,
      expiresAt: new Date(req.expiresAtMs),
    });

    return {
      authorizationUrl: req.authorizationUrl,
      signedState: req.signedState,
      nonce: req.nonce,
    };
  }

  public async consumeSingleUseOAuthState(params: {
    readonly context: TenantContext;
    readonly signedState: string;
    readonly stateSigningSecret: string;
    readonly nowMs?: number;
  }): Promise<{
    readonly nonce: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
  }> {
    const nowMs = params.nowMs ?? Date.now();
    const verified = verifyGoogleAdsOAuthState({
      context: params.context,
      signedState: params.signedState,
      stateSigningSecret: params.stateSigningSecret,
      nowMs,
    });

    const rows: (typeof schema.oauthStates.$inferSelect)[] = await this.db
      .select()
      .from(schema.oauthStates)
      .where(
        and(
          eq(schema.oauthStates.nonce, verified.nonce),
          eq(schema.oauthStates.organizationId, params.context.organizationId)
        )
      );

    const record = rows[0];
    if (!record) {
      throw new Error("OAuth State Error: State nonce not found in database.");
    }

    if (record.consumedAt !== null) {
      throw new Error(
        "OAuth State Error: State token has already been used (replay attempt blocked)."
      );
    }

    if (new Date(record.expiresAt).getTime() <= nowMs) {
      throw new Error("OAuth State Error: Persisted state has expired.");
    }

    await this.db
      .update(schema.oauthStates)
      .set({ consumedAt: new Date(nowMs) })
      .where(eq(schema.oauthStates.nonce, verified.nonce));

    return {
      nonce: record.nonce,
      codeVerifier: record.codeVerifier,
      redirectUri: record.redirectUri,
    };
  }

  public async exchangeCodeAndPersistIntegration(params: {
    readonly context: TenantContext;
    readonly signedState: string;
    readonly authorizationCode: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly stateSigningSecret: string;
    readonly externalAccountLabel: string;
    readonly managerCustomerId?: string | null;
    readonly nowMs?: number;
    readonly customPinnedExecutor?: PinnedHttpsRequestOptions["customPinnedExecutor"];
    readonly dnsResolver?: PinnedHttpsRequestOptions["dnsResolver"];
  }): Promise<
    Omit<
      typeof schema.integrations.$inferSelect,
      "encryptedAccessToken" | "encryptedRefreshToken"
    >
  > {
    const {
      context,
      signedState,
      authorizationCode,
      clientId,
      clientSecret,
      stateSigningSecret,
      externalAccountLabel,
      managerCustomerId = null,
      nowMs = Date.now(),
      customPinnedExecutor,
      dnsResolver,
    } = params;

    assertPermission(context, "integrations:manage");

    const consumed = await this.consumeSingleUseOAuthState({
      context,
      signedState,
      stateSigningSecret,
      nowMs,
    });

    const formBody = new URLSearchParams({
      code: authorizationCode,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: consumed.redirectUri,
      grant_type: "authorization_code",
      code_verifier: consumed.codeVerifier,
    }).toString();

    const tokenResp = await executePinnedHttpsRequest({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody,
      customPinnedExecutor,
      dnsResolver,
    });

    if (tokenResp.statusCode !== 200) {
      await this.db.insert(schema.auditLogs).values({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        actorType: "USER",
        action: "INTEGRATION_OAUTH_EXCHANGE_FAILED",
        entityType: "integration",
        entityId: consumed.nonce.slice(0, 16),
        newState: { statusCode: tokenResp.statusCode },
      });

      throw new ProviderIntegrationError(
        "GOOGLE_ADS",
        "AUTH_TOKEN_REVOKED",
        false,
        `OAuth token exchange failed with HTTP ${tokenResp.statusCode}.`
      );
    }

    const tokenData = tokenResp.json<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    }>();

    if (!tokenData.access_token) {
      throw new ProviderIntegrationError(
        "GOOGLE_ADS",
        "AUTH_TOKEN_REVOKED",
        false,
        "OAuth token response did not include an access_token."
      );
    }

    // First insert row to obtain its UUID for AAD binding
    const [inserted] = await this.db
      .insert(schema.integrations)
      .values({
        organizationId: context.organizationId,
        provider: "GOOGLE_ADS",
        externalAccountLabel: externalAccountLabel.trim(),
        managerCustomerId: managerCustomerId
          ? normalizeGoogleAdsCustomerId(managerCustomerId)
          : null,
        status: "CONNECTED",
        encryptionKeyVersion: this.activeKeyVersion,
        scopes: [GOOGLE_ADS_OAUTH_SCOPE],
        tokenExpiresAt: new Date(
          nowMs + (tokenData.expires_in ?? 3600) * 1000
        ),
        isDemoIntegration: false,
      })
      .returning();

    if (!inserted) {
      throw new Error("Falha ao criar registro de integração no PostgreSQL.");
    }

    const aad = {
      organizationId: context.organizationId,
      integrationId: inserted.id,
    };

    const encryptedAccessToken = encryptVaultCredentialWithMandatoryAad({
      plainText: tokenData.access_token,
      keyRing: this.keyRing,
      keyVersion: this.activeKeyVersion,
      aad,
    });

    const encryptedRefreshToken = tokenData.refresh_token
      ? encryptVaultCredentialWithMandatoryAad({
          plainText: tokenData.refresh_token,
          keyRing: this.keyRing,
          keyVersion: this.activeKeyVersion,
          aad,
        })
      : null;

    const [updated] = await this.db
      .update(schema.integrations)
      .set({
        encryptedAccessToken,
        encryptedRefreshToken,
        updatedAt: new Date(nowMs),
      })
      .where(
        and(
          eq(schema.integrations.organizationId, context.organizationId),
          eq(schema.integrations.id, inserted.id)
        )
      )
      .returning();

    if (!updated) {
      throw new Error("Falha ao persistir tokens criptografados na integração.");
    }

    await this.db.insert(schema.auditLogs).values({
      organizationId: context.organizationId,
      actorUserId: context.userId,
      actorType: "USER",
      action: "INTEGRATION_CONNECTED",
      entityType: "integration",
      entityId: updated.id,
      newState: {
        provider: "GOOGLE_ADS",
        status: "CONNECTED",
        encryptionKeyVersion: this.activeKeyVersion,
      },
    });

    const {
      encryptedAccessToken: _eat,
      encryptedRefreshToken: _ert,
      ...publicIntegration
    } = updated;
    void _eat;
    void _ert;
    return publicIntegration;
  }

  public async refreshAccessTokenInPostgres(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly nowMs?: number;
    readonly customPinnedExecutor?: PinnedHttpsRequestOptions["customPinnedExecutor"];
    readonly dnsResolver?: PinnedHttpsRequestOptions["dnsResolver"];
  }): Promise<{ readonly status: "CONNECTED"; readonly tokenExpiresAtIso: string }> {
    const {
      context,
      integrationId,
      clientId,
      clientSecret,
      nowMs = Date.now(),
      customPinnedExecutor,
      dnsResolver,
    } = params;

    assertTenantAccess(context, context.organizationId);

    const rows: (typeof schema.integrations.$inferSelect)[] = await this.db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.organizationId, context.organizationId),
          eq(schema.integrations.id, integrationId)
        )
      );

    const record = rows[0];
    if (!record) {
      throw new Error(`Integration '${integrationId}' not found.`);
    }

    if (record.status === "REVOKED" || !record.encryptedRefreshToken) {
      throw new ProviderIntegrationError(
        "GOOGLE_ADS",
        "AUTH_TOKEN_REVOKED",
        false,
        "Cannot refresh token: integration is revoked or has no refresh token."
      );
    }

    const aad = {
      organizationId: context.organizationId,
      integrationId: record.id,
    };

    const plainRefreshToken = decryptVaultCredentialWithMandatoryAad({
      cipherPayload: record.encryptedRefreshToken,
      keyRing: this.keyRing,
      aad,
    });

    const formBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: plainRefreshToken,
      grant_type: "refresh_token",
    }).toString();

    const resp = await executePinnedHttpsRequest({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody,
      customPinnedExecutor,
      dnsResolver,
    });

    if (resp.statusCode !== 200) {
      await this.db
        .update(schema.integrations)
        .set({
          status: "REVOKED",
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          revokedAt: new Date(nowMs),
          updatedAt: new Date(nowMs),
        })
        .where(eq(schema.integrations.id, record.id));

      throw new ProviderIntegrationError(
        "GOOGLE_ADS",
        "AUTH_TOKEN_REVOKED",
        false,
        `OAuth token refresh rejected by provider (HTTP ${resp.statusCode}).`
      );
    }

    const refreshed = resp.json<{ access_token: string; expires_in: number }>();
    const newEncryptedAccess = encryptVaultCredentialWithMandatoryAad({
      plainText: refreshed.access_token,
      keyRing: this.keyRing,
      keyVersion: this.activeKeyVersion,
      aad,
    });

    const expiresAt = new Date(
      nowMs + (refreshed.expires_in ?? 3600) * 1000
    );

    await this.db
      .update(schema.integrations)
      .set({
        status: "CONNECTED",
        encryptedAccessToken: newEncryptedAccess,
        encryptionKeyVersion: this.activeKeyVersion,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(nowMs),
      })
      .where(eq(schema.integrations.id, record.id));

    return {
      status: "CONNECTED",
      tokenExpiresAtIso: expiresAt.toISOString(),
    };
  }

  public async rotateIntegrationVaultKeyInPostgres(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly targetKeyVersion: string;
  }): Promise<{ readonly integrationId: string; readonly encryptionKeyVersion: string }> {
    const { context, integrationId, targetKeyVersion } = params;
    assertPermission(context, "integrations:manage");

    if (typeof this.keyRing === "string") {
      throw new Error("Key rotation requires a multi-version KeyRing object.");
    }

    const rows: (typeof schema.integrations.$inferSelect)[] = await this.db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.organizationId, context.organizationId),
          eq(schema.integrations.id, integrationId)
        )
      );

    const record = rows[0];
    if (!record || !record.encryptedAccessToken) {
      throw new Error(`Active integration '${integrationId}' not found.`);
    }

    const aad = {
      organizationId: context.organizationId,
      integrationId: record.id,
    };

    const rotatedAccess = rotateVaultCredentialKeyVersion({
      cipherPayload: record.encryptedAccessToken,
      keyRing: this.keyRing,
      targetKeyVersion,
      aad,
    });

    const rotatedRefresh = record.encryptedRefreshToken
      ? rotateVaultCredentialKeyVersion({
          cipherPayload: record.encryptedRefreshToken,
          keyRing: this.keyRing,
          targetKeyVersion,
          aad,
        }).rotatedCipherPayload
      : null;

    await this.db
      .update(schema.integrations)
      .set({
        encryptedAccessToken: rotatedAccess.rotatedCipherPayload,
        encryptedRefreshToken: rotatedRefresh,
        encryptionKeyVersion: targetKeyVersion,
        updatedAt: new Date(),
      })
      .where(eq(schema.integrations.id, record.id));

    await this.db.insert(schema.auditLogs).values({
      organizationId: context.organizationId,
      actorUserId: context.userId,
      actorType: "USER",
      action: "VAULT_KEY_ROTATED",
      entityType: "integration",
      entityId: record.id,
      previousState: { encryptionKeyVersion: record.encryptionKeyVersion },
      newState: { encryptionKeyVersion: targetKeyVersion },
    });

    return {
      integrationId: record.id,
      encryptionKeyVersion: targetKeyVersion,
    };
  }

  public async revokeIntegrationInPostgres(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly nowMs?: number;
  }): Promise<{
    readonly integrationId: string;
    readonly status: "REVOKED";
    readonly revokedAtIso: string;
  }> {
    const { context, integrationId, nowMs = Date.now() } = params;
    assertPermission(context, "integrations:manage");

    const rows: (typeof schema.integrations.$inferSelect)[] = await this.db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.organizationId, context.organizationId),
          eq(schema.integrations.id, integrationId)
        )
      );

    const record = rows[0];
    if (!record) {
      throw new Error(`Integration '${integrationId}' not found.`);
    }

    const revokedAt = new Date(nowMs);
    await this.db
      .update(schema.integrations)
      .set({
        status: "REVOKED",
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        tokenExpiresAt: null,
        revokedAt,
        updatedAt: revokedAt,
      })
      .where(eq(schema.integrations.id, record.id));

    await this.db.insert(schema.auditLogs).values({
      organizationId: context.organizationId,
      actorUserId: context.userId,
      actorType: "USER",
      action: "INTEGRATION_REVOKED",
      entityType: "integration",
      entityId: record.id,
      previousState: { status: record.status },
      newState: { status: "REVOKED" },
    });

    return {
      integrationId: record.id,
      status: "REVOKED",
      revokedAtIso: revokedAt.toISOString(),
    };
  }

  public async resolveDecryptedTokenFromPostgres(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
  }): Promise<{
    readonly accessToken: string;
    readonly managerCustomerId: string | null;
  }> {
    const { context, integrationId } = params;
    assertTenantAccess(context, context.organizationId);

    const rows: (typeof schema.integrations.$inferSelect)[] = await this.db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.organizationId, context.organizationId),
          eq(schema.integrations.id, integrationId)
        )
      );

    const record = rows[0];
    if (!record) {
      throw new Error(`Integration '${integrationId}' not found.`);
    }

    if (record.status === "REVOKED" || !record.encryptedAccessToken) {
      throw new ProviderIntegrationError(
        "GOOGLE_ADS",
        "AUTH_TOKEN_REVOKED",
        false,
        `Google Ads integration '${integrationId}' has been revoked and cannot be used.`
      );
    }

    const accessToken = decryptVaultCredentialWithMandatoryAad({
      cipherPayload: record.encryptedAccessToken,
      keyRing: this.keyRing,
      aad: {
        organizationId: context.organizationId,
        integrationId: record.id,
      },
    });

    return {
      accessToken,
      managerCustomerId: record.managerCustomerId,
    };
  }

  /**
   * Lists accessible Google Ads customer IDs via the official REST endpoint:
   * `GET https://googleads.googleapis.com/v26/customers:listAccessibleCustomers`
   */
  public async listAccessibleCustomersViaRest(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly customPinnedExecutor?: PinnedHttpsRequestOptions["customPinnedExecutor"];
    readonly dnsResolver?: PinnedHttpsRequestOptions["dnsResolver"];
  }): Promise<readonly string[]> {
    const { accessToken } = await this.resolveDecryptedTokenFromPostgres({
      context: params.context,
      integrationId: params.integrationId,
    });

    const resp = await executePinnedHttpsRequest({
      url: `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      customPinnedExecutor: params.customPinnedExecutor,
      dnsResolver: params.dnsResolver,
    });

    if (isCloudProjectNotApprovedForProductionError(resp.bodyText)) {
      throw new GoogleAdsCloudProjectApprovalError();
    }

    if (resp.statusCode === 401 || resp.statusCode === 403) {
      throw new ProviderIntegrationError(
        "GOOGLE_ADS",
        "AUTH_TOKEN_REVOKED",
        false,
        `Google Ads listAccessibleCustomers failed with HTTP ${resp.statusCode}.`
      );
    }

    if (resp.statusCode !== 200) {
      throw new ProviderIntegrationError(
        "GOOGLE_ADS",
        "RATE_LIMIT_EXCEEDED",
        resp.statusCode === 429 || resp.statusCode >= 500,
        `Google Ads listAccessibleCustomers returned HTTP ${resp.statusCode}.`
      );
    }

    const data = resp.json<{ resourceNames?: string[] }>();
    return (data.resourceNames ?? []).map((rn) =>
      normalizeGoogleAdsCustomerId(rn)
    );
  }

  /**
   * Executes a read-only GAQL query against the official Google Ads REST endpoint:
   * `POST https://googleads.googleapis.com/v26/customers/{customerId}/googleAds:search`
   * with pagination (`nextPageToken`), exponential backoff retries, and MCC `login-customer-id`.
   */
  public async executeReadOnlyGaqlSearchViaRest<T = Record<string, unknown>>(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly customerId: string;
    readonly gaqlQuery: string;
    readonly managerCustomerId?: string | null;
    readonly developerToken?: string | null;
    readonly pageSize?: number;
    readonly maxPages?: number;
    readonly customPinnedExecutor?: PinnedHttpsRequestOptions["customPinnedExecutor"];
    readonly dnsResolver?: PinnedHttpsRequestOptions["dnsResolver"];
  }): Promise<T[]> {
    const {
      context,
      integrationId,
      customerId,
      gaqlQuery,
      managerCustomerId: explicitManagerCustomerId,
      developerToken,
      pageSize = 10_000,
      maxPages = 10,
      customPinnedExecutor,
      dnsResolver,
    } = params;

    const trimmedQuery = gaqlQuery.trim();
    if (
      !/^SELECT\s+/i.test(trimmedQuery) ||
      /\b(MUTATE|INSERT|UPDATE|DELETE|REMOVE|CREATE)\b/i.test(trimmedQuery)
    ) {
      throw new ProviderIntegrationError(
        "GOOGLE_ADS",
        "POLICY_VIOLATION",
        false,
        "GoogleAds API service strictly enforces READ_ONLY SELECT GAQL queries."
      );
    }

    const { accessToken, managerCustomerId: storedManagerCustomerId } =
      await this.resolveDecryptedTokenFromPostgres({
        context,
        integrationId,
      });

    const effectiveManagerCustomerId =
      explicitManagerCustomerId !== undefined
        ? explicitManagerCustomerId
        : storedManagerCustomerId;

    const normalizedCustomerId = normalizeGoogleAdsCustomerId(customerId);
    const headers = buildGoogleAdsReadOnlyHeaders({
      accessToken,
      developerToken,
      managerCustomerId: effectiveManagerCustomerId,
    });

    const aggregated: T[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      pageCount += 1;
      let attempt = 0;
      const maxAttempts = 3;

      while (true) {
        try {
          const payload: Record<string, unknown> = {
            query: trimmedQuery,
            pageSize,
          };
          if (pageToken) {
            payload.pageToken = pageToken;
          }

          const resp = await executePinnedHttpsRequest({
            url: `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${normalizedCustomerId}/googleAds:search`,
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            customPinnedExecutor,
            dnsResolver,
          });

          if (isCloudProjectNotApprovedForProductionError(resp.bodyText)) {
            throw new GoogleAdsCloudProjectApprovalError();
          }

          if (resp.statusCode === 429 || resp.statusCode === 503) {
            throw new ProviderIntegrationError(
              "GOOGLE_ADS",
              "RATE_LIMIT_EXCEEDED",
              true,
              `Google Ads API transient HTTP ${resp.statusCode}.`
            );
          }

          if (resp.statusCode === 401 || resp.statusCode === 403) {
            throw new ProviderIntegrationError(
              "GOOGLE_ADS",
              "AUTH_TOKEN_REVOKED",
              false,
              `Google Ads API authentication/permission error HTTP ${resp.statusCode}.`
            );
          }

          if (resp.statusCode !== 200) {
            throw new ProviderIntegrationError(
              "GOOGLE_ADS",
              "POLICY_VIOLATION",
              false,
              `Google Ads API error HTTP ${resp.statusCode}.`
            );
          }

          const bodyJson = resp.json<{
            results?: T[];
            nextPageToken?: string;
          }>();
          if (bodyJson.results) {
            aggregated.push(...bodyJson.results);
          }
          pageToken = bodyJson.nextPageToken;
          break;
        } catch (err) {
          attempt += 1;
          const isRetryable =
            err instanceof ProviderIntegrationError && err.retryable;
          if (!isRetryable || attempt >= maxAttempts) {
            await this.db.insert(schema.auditLogs).values({
              organizationId: context.organizationId,
              actorUserId: context.userId,
              actorType: "SYSTEM",
              action: "GOOGLE_ADS_API_QUERY_FAILED",
              entityType: "integration",
              entityId: integrationId,
              newState: {
                customerId: normalizedCustomerId,
                attempt,
              },
            });
            throw err;
          }
        }
      }
    } while (pageToken && pageCount < maxPages);

    return aggregated;
  }
}

/**
 * Legacy-compatible service wrapper for existing Stage 2 unit tests.
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

    if (existing.status === "REVOKED" || !existing.encryptedAccessToken) {
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
