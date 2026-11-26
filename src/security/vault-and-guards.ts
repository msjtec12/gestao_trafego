import crypto from "crypto";

const SENSITIVE_KEYS_REGEX =
  /^(password|secret|token|access_?token|refresh_?token|client_?secret|api_?key|authorization|developer_?token|encrypted_?.*|cookie)$/i;

export function redactSensitiveData<T>(payload: T): T {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => redactSensitiveData(item)) as unknown as T;
  }

  if (typeof payload === "object") {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      payload as Record<string, unknown>
    )) {
      if (SENSITIVE_KEYS_REGEX.test(key)) {
        clean[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        clean[key] = redactSensitiveData(value);
      } else {
        clean[key] = value;
      }
    }
    return clean as T;
  }

  return payload;
}

export function encryptCredential(
  plainText: string,
  hexKey64: string
): string {
  if (hexKey64.length !== 64) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)."
    );
  }
  const key = Buffer.from(hexKey64, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptCredential(
  cipherPayload: string,
  hexKey64: string
): string {
  if (hexKey64.length !== 64) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)."
    );
  }
  const parts = cipherPayload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted credential payload format.");
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error("Malformed encrypted credential components.");
  }
  const key = Buffer.from(hexKey64, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
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

  const host = parsed.hostname.toLowerCase();
  const forbiddenHostPatterns = [
    /^localhost$/,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^169\.254\./,
    /^0\./,
    /^\[::1\]$/,
    /\.internal$/,
    /\.local$/,
  ];

  if (forbiddenHostPatterns.some((pattern) => pattern.test(host))) {
    throw new Error(
      `SSRF Guard: Destination host '${host}' is blocked by internal network protection.`
    );
  }

  return parsed;
}
