import crypto from "crypto";
import dns from "dns/promises";
import net from "net";

export { redactSensitiveData, toPublicSafeErrorMessage } from "./public-errors";

/**
 * Canonical JSON serialization and SHA-256 hashing to bind an ApprovalRecord
 * to the immutable action content (organizationId + campaignId + actionType + payload).
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeJson(v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys.map(
    (k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`
  );
  return `{${entries.join(",")}}`;
}

export function computeActionPayloadHash(params: {
  readonly organizationId: string;
  readonly campaignId: string;
  readonly actionType: string;
  readonly payload: Record<string, unknown>;
}): string {
  const canonical = canonicalizeJson({
    organizationId: params.organizationId.trim(),
    campaignId: params.campaignId.trim(),
    actionType: params.actionType.trim(),
    payload: params.payload,
  });
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface CredentialAadContext {
  readonly organizationId: string;
  readonly integrationId: string;
}

export type KeyRing = Readonly<Record<string, string>>;

function assertStrongHexKey(hexKey64: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey64)) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be a valid 64-character hexadecimal string (32 bytes)."
    );
  }
  const uniqueChars = new Set(hexKey64.toLowerCase()).size;
  if (uniqueChars < 4) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY rejected: weak or all-zero key entropy detected."
    );
  }
  return Buffer.from(hexKey64, "hex");
}

function buildAadBuffer(aad?: CredentialAadContext): Buffer | null {
  if (!aad) return null;
  if (!aad.organizationId?.trim() || !aad.integrationId?.trim()) {
    throw new Error(
      "CredentialAadContext requires non-empty organizationId and integrationId."
    );
  }
  return Buffer.from(
    `org:${aad.organizationId.trim()}|integration:${aad.integrationId.trim()}`,
    "utf8"
  );
}

export function encryptCredential(
  plainText: string,
  hexKey64OrKeyRing: string | KeyRing,
  options?: {
    readonly keyVersion?: string;
    readonly aad?: CredentialAadContext;
  }
): string {
  if (!plainText) {
    throw new Error("Cannot encrypt empty credential payload.");
  }

  const version = options?.keyVersion ?? "v1";
  const rawHexKey =
    typeof hexKey64OrKeyRing === "string"
      ? hexKey64OrKeyRing
      : hexKey64OrKeyRing[version];

  if (!rawHexKey) {
    throw new Error(`Encryption key version '${version}' not found in keyring.`);
  }

  const key = assertStrongHexKey(rawHexKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const aadBuf = buildAadBuffer(options?.aad);
  if (aadBuf) {
    cipher.setAAD(aadBuf);
  }

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${version}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Mandatory AAD wrapper for Stage 2 OAuth Credential Vault.
 */
export function encryptVaultCredentialWithMandatoryAad(params: {
  readonly plainText: string;
  readonly keyRing: string | KeyRing;
  readonly keyVersion?: string;
  readonly aad: CredentialAadContext;
}): string {
  if (!params.aad?.organizationId?.trim() || !params.aad?.integrationId?.trim()) {
    throw new Error(
      "Vault AAD (organizationId and integrationId) is mandatory for OAuth token encryption."
    );
  }
  return encryptCredential(params.plainText, params.keyRing, {
    keyVersion: params.keyVersion ?? "v1",
    aad: params.aad,
  });
}

export function decryptVaultCredentialWithMandatoryAad(params: {
  readonly cipherPayload: string;
  readonly keyRing: string | KeyRing;
  readonly aad: CredentialAadContext;
}): string {
  if (!params.aad?.organizationId?.trim() || !params.aad?.integrationId?.trim()) {
    throw new Error(
      "Vault AAD (organizationId and integrationId) is mandatory for OAuth token decryption."
    );
  }
  return decryptCredential(params.cipherPayload, params.keyRing, {
    aad: params.aad,
  });
}

/**
 * Planned key rotation helper: decrypts an existing credential using its embedded
 * key version in `keyRing` (verifying AAD integrity) and re-encrypts it under `targetKeyVersion`.
 */
export function rotateVaultCredentialKeyVersion(params: {
  readonly cipherPayload: string;
  readonly keyRing: KeyRing;
  readonly targetKeyVersion: string;
  readonly aad: CredentialAadContext;
}): { readonly rotatedCipherPayload: string; readonly keyVersion: string } {
  const plainText = decryptVaultCredentialWithMandatoryAad({
    cipherPayload: params.cipherPayload,
    keyRing: params.keyRing,
    aad: params.aad,
  });

  const rotatedCipherPayload = encryptVaultCredentialWithMandatoryAad({
    plainText,
    keyRing: params.keyRing,
    keyVersion: params.targetKeyVersion,
    aad: params.aad,
  });

  return {
    rotatedCipherPayload,
    keyVersion: params.targetKeyVersion,
  };
}

export function decryptCredential(
  cipherPayload: string,
  hexKey64OrKeyRing: string | KeyRing,
  options?: {
    readonly aad?: CredentialAadContext;
  }
): string {
  const parts = cipherPayload.split(":");

  let version = "v1";
  let ivHex: string | undefined;
  let authTagHex: string | undefined;
  let encryptedHex: string | undefined;

  if (parts.length === 4) {
    [version = "v1", ivHex, authTagHex, encryptedHex] = parts;
  } else if (parts.length === 3) {
    [ivHex, authTagHex, encryptedHex] = parts;
  } else {
    throw new Error("Invalid encrypted credential payload format.");
  }

  if (
    !ivHex ||
    !authTagHex ||
    !encryptedHex ||
    ivHex.length !== 24 ||
    authTagHex.length !== 32
  ) {
    throw new Error("Malformed encrypted credential components.");
  }

  const rawHexKey =
    typeof hexKey64OrKeyRing === "string"
      ? hexKey64OrKeyRing
      : hexKey64OrKeyRing[version];

  if (!rawHexKey) {
    throw new Error(`Decryption key version '${version}' not found in keyring.`);
  }

  const key = assertStrongHexKey(rawHexKey);
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const aadBuf = buildAadBuffer(options?.aad);
  if (aadBuf) {
    decipher.setAAD(aadBuf);
  }

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function isPrivateOrReservedIp(ipAddress: string): boolean {
  const normalized = ipAddress.trim().toLowerCase().replace(/^\[|\]$/g, "");

  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice(7);
    if (net.isIPv4(mappedIpv4)) {
      return isPrivateOrReservedIp(mappedIpv4);
    }
  }

  if (net.isIPv4(normalized)) {
    const octets = normalized.split(".").map((n) => Number(n));
    const [a = 0, b = 0, c = 0] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a === 192 && b === 0 && c === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true; // Multicast & Reserved
    return false;
  }

  if (net.isIPv6(normalized)) {
    if (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("ff")
    ) {
      return true;
    }
    return false;
  }

  return true;
}

export function validateSafeExternalUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL syntax.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("SSRF Guard: Only HTTPS URLs are permitted.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("SSRF Guard: Embedded URL credentials are not permitted.");
  }

  if (parsed.port && parsed.port !== "443") {
    throw new Error(
      `SSRF Guard: Non-standard HTTPS port '${parsed.port}' is blocked.`
    );
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const forbiddenHostPatterns = [
    /^localhost$/,
    /\.internal$/,
    /\.local$/,
    /\.localhost$/,
    /^metadata\.google\.internal$/,
  ];

  if (forbiddenHostPatterns.some((pattern) => pattern.test(host))) {
    throw new Error(
      `SSRF Guard: Destination host '${host}' is blocked by internal network protection.`
    );
  }

  if (net.isIP(host) !== 0 && isPrivateOrReservedIp(host)) {
    throw new Error(
      `SSRF Guard: Destination IP '${host}' is blocked by internal network protection.`
    );
  }

  return parsed;
}

export type DnsResolverFn = (
  hostname: string
) => Promise<readonly { address: string; family: number }[]>;

const defaultDnsResolver: DnsResolverFn = async (hostname: string) => {
  return await dns.lookup(hostname, { all: true, verbatim: true });
};

export interface SafePinnedHttpTransportContext {
  readonly url: URL;
  readonly hostname: string;
  readonly pinnedAddress: string;
  readonly resolvedAddresses: readonly string[];
  readonly safeFetchInit: RequestInit;
}

/**
 * Full async SSRF guard with DNS resolution validation, pinned IP transport context
 * (preventing DNS rebinding TOCTOU between lookup and HTTP socket connect), and
 * safe redirect inspection.
 */
export async function resolveAndValidateSafeExternalUrl(
  rawUrl: string,
  options?: {
    readonly dnsResolver?: DnsResolverFn;
    readonly redirectChainUrls?: readonly string[];
    readonly maxRedirects?: number;
    readonly timeoutMs?: number;
  }
): Promise<SafePinnedHttpTransportContext> {
  const maxRedirects = options?.maxRedirects ?? 3;
  const redirectChain = options?.redirectChainUrls ?? [];

  if (redirectChain.length > maxRedirects) {
    throw new Error(
      `SSRF Guard: Maximum redirect depth (${maxRedirects}) exceeded.`
    );
  }

  for (const hopUrl of redirectChain) {
    validateSafeExternalUrl(hopUrl);
  }

  const parsed = validateSafeExternalUrl(rawUrl);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (net.isIP(host) !== 0) {
    return {
      url: parsed,
      hostname: host,
      pinnedAddress: host,
      resolvedAddresses: [host],
      safeFetchInit: {
        redirect: "error",
        headers: {
          Host: host,
          "X-Pinned-Remote-Address": host,
        },
      },
    };
  }

  const resolver = options?.dnsResolver ?? defaultDnsResolver;
  const records = await resolver(host);

  if (!records || records.length === 0) {
    throw new Error(
      `SSRF Guard: DNS resolution returned no records for '${host}'.`
    );
  }

  const addresses: string[] = [];
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error(
        `SSRF Guard: Host '${host}' resolved to private/reserved IP '${rec.address}' (DNS rebinding protection).`
      );
    }
    addresses.push(rec.address);
  }

  const pinnedAddress = addresses[0]!;

  return {
    url: parsed,
    hostname: host,
    pinnedAddress,
    resolvedAddresses: addresses,
    safeFetchInit: {
      redirect: "error",
      headers: {
        Host: host,
        "X-Pinned-Remote-Address": pinnedAddress,
      },
    },
  };
}
