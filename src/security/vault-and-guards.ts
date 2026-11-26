import crypto from "crypto";
import dns from "dns/promises";
import net from "net";

const SENSITIVE_KEYS_REGEX =
  /^(password|secret|token|access_?token|refresh_?token|client_?secret|api_?key|authorization|developer_?token|encrypted_?.*|cookie|session_?token|private_?key|webhook_?secret)$/i;

const INLINE_BEARER_OR_KEY_REGEX =
  /(Bearer\s+[A-Za-z0-9\-._~+/]+=*|sk-[A-Za-z0-9]{16,}|ya29\.[A-Za-z0-9\-_]+)/gi;

export function redactSensitiveData<T>(
  payload: T,
  seen: WeakSet<object> = new WeakSet()
): T {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (typeof payload === "string") {
    return payload.replace(
      INLINE_BEARER_OR_KEY_REGEX,
      "[REDACTED_TOKEN]"
    ) as unknown as T;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => redactSensitiveData(item, seen)) as unknown as T;
  }

  if (typeof payload === "object") {
    if (seen.has(payload as object)) {
      return "[CIRCULAR_REF]" as unknown as T;
    }
    seen.add(payload as object);

    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      payload as Record<string, unknown>
    )) {
      if (SENSITIVE_KEYS_REGEX.test(key)) {
        clean[key] = "[REDACTED]";
      } else {
        clean[key] = redactSensitiveData(value, seen);
      }
    }
    return clean as T;
  }

  return payload;
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

/**
 * Encrypts OAuth credentials with AES-256-GCM, key versioning (v1:iv:tag:cipher),
 * high-entropy key validation, and optional tenant+integration AAD binding.
 */
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

/**
 * Full async SSRF guard with DNS resolution validation and safe redirect inspection.
 */
export async function resolveAndValidateSafeExternalUrl(
  rawUrl: string,
  options?: {
    readonly dnsResolver?: DnsResolverFn;
    readonly redirectChainUrls?: readonly string[];
    readonly maxRedirects?: number;
  }
): Promise<{
  readonly url: URL;
  readonly resolvedAddresses: readonly string[];
  readonly safeFetchInit: RequestInit;
}> {
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
      resolvedAddresses: [host],
      safeFetchInit: { redirect: "error" },
    };
  }

  const resolver = options?.dnsResolver ?? defaultDnsResolver;
  const records = await resolver(host);

  if (!records || records.length === 0) {
    throw new Error(`SSRF Guard: DNS resolution returned no records for '${host}'.`);
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

  return {
    url: parsed,
    resolvedAddresses: addresses,
    safeFetchInit: { redirect: "error" },
  };
}
