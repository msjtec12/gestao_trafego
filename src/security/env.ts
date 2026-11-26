import { z } from "zod";

const DEMO_SECRET_PATTERNS = [
  /^replace_with_/i,
  /^sk-replace_with_/i,
  /^0{16,}$/,
  /^1{16,}$/,
  /^f{16,}$/i,
  /^example/i,
  /^changeme/i,
  /^konnexy-ads-default-/i,
];

export class MissingOrWeakSecretError extends Error {
  public readonly code = "MISSING_OR_WEAK_SECRET";
  public readonly statusCode = 500;

  constructor(
    public readonly secretName: string,
    message: string
  ) {
    super(message);
    this.name = "MissingOrWeakSecretError";
  }
}

export function isPlaceholderOrWeakSecret(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 16) return true;
  if (DEMO_SECRET_PATTERNS.some((p) => p.test(trimmed))) return true;
  const uniqueChars = new Set(trimmed.toLowerCase()).size;
  return uniqueChars < 4;
}

export const ServerEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    NEXT_PUBLIC_APP_NAME: z.string().min(2).default("Konnexy Ads"),
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
    NEXT_PUBLIC_APP_DOMAIN: z.string().min(3).default("ads.konnexy.com.br"),
    NEXT_PUBLIC_DEFAULT_EXECUTION_MODE: z
      .enum(["READ_ONLY", "SUPERVISED"])
      .default("READ_ONLY"),
    DATABASE_URL: z.string().min(12),
    DATABASE_ADMIN_URL: z.string().min(12).optional(),
    KONNEXY_ALLOW_PGLITE_DEV: z.enum(["true", "false"]).optional(),
    AUTH_SECRET: z.string().min(32),
    CREDENTIALS_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "Must be a 64-character hex key (256 bits)"),
    CREDENTIALS_ENCRYPTION_KEY_VERSION: z
      .string()
      .regex(/^v[1-9][0-9]*$/)
      .default("v1"),
    GOOGLE_ADS_CLIENT_ID: z.string().optional(),
    GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
    OAUTH_STATE_SIGNING_SECRET: z.string().min(32).optional(),
    AUTOMATION_GLOBAL_KILL_SWITCH: z
      .enum(["true", "false"])
      .default("false"),
    AUTOMATION_MAX_DAILY_BUDGET_CHANGE_PCT: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20),
    AUTOMATION_MIN_COOLDOWN_MINUTES: z.coerce
      .number()
      .int()
      .min(15)
      .max(10080)
      .default(360),
  })
  .superRefine((env, ctx) => {
    if (isPlaceholderOrWeakSecret(env.AUTH_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_SECRET"],
        message:
          "Server environment rejected demonstration or low-entropy AUTH_SECRET.",
      });
    }
    if (isPlaceholderOrWeakSecret(env.CREDENTIALS_ENCRYPTION_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CREDENTIALS_ENCRYPTION_KEY"],
        message:
          "Server environment rejected demonstration or low-entropy CREDENTIALS_ENCRYPTION_KEY.",
      });
    }
    if (env.NODE_ENV === "production") {
      if (
        env.DATABASE_URL.includes("replace_with_password") ||
        env.DATABASE_URL.includes("localhost") ||
        env.DATABASE_URL.includes("127.0.0.1")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["DATABASE_URL"],
          message:
            "Production environment requires a valid Neon PostgreSQL DATABASE_URL (placeholder or localhost rejected).",
        });
      }
      if (env.KONNEXY_ALLOW_PGLITE_DEV === "true") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["KONNEXY_ALLOW_PGLITE_DEV"],
          message:
            "PGlite is strictly prohibited in production (KONNEXY_ALLOW_PGLITE_DEV cannot be true).",
        });
      }
    }
  });

export type ValidatedServerEnv = z.infer<typeof ServerEnvSchema>;

export function validateServerEnv(
  rawEnv: Record<string, string | undefined> = process.env
): ValidatedServerEnv {
  return ServerEnvSchema.parse(rawEnv);
}

/**
 * Requires a valid 64-character hex AES-256-GCM key from `CREDENTIALS_ENCRYPTION_KEY`.
 * Strictly zero hardcoded fallback keys in application code.
 */
export function requireCredentialsEncryptionKey(
  rawEnv: Record<string, string | undefined> = process.env
): { readonly keyHex: string; readonly keyVersion: string } {
  const keyHex = rawEnv.CREDENTIALS_ENCRYPTION_KEY?.trim() ?? "";
  if (
    !/^[0-9a-fA-F]{64}$/.test(keyHex) ||
    isPlaceholderOrWeakSecret(keyHex)
  ) {
    throw new MissingOrWeakSecretError(
      "CREDENTIALS_ENCRYPTION_KEY",
      "CREDENTIALS_ENCRYPTION_KEY ausente ou inválida. Configure uma chave hexadecimal de 64 caracteres (256 bits) no ambiente."
    );
  }
  const keyVersion = rawEnv.CREDENTIALS_ENCRYPTION_KEY_VERSION?.trim() || "v1";
  if (!/^v[1-9][0-9]*$/.test(keyVersion)) {
    throw new MissingOrWeakSecretError(
      "CREDENTIALS_ENCRYPTION_KEY_VERSION",
      "CREDENTIALS_ENCRYPTION_KEY_VERSION inválida (formato esperado: v1, v2, ...)."
    );
  }
  return { keyHex, keyVersion };
}

/**
 * Requires a valid high-entropy `AUTH_SECRET` (>= 32 chars).
 * Strictly zero hardcoded fallback secrets in application code.
 */
export function requireAuthSecret(
  rawEnv: Record<string, string | undefined> = process.env
): string {
  const secret = rawEnv.AUTH_SECRET?.trim() ?? "";
  if (secret.length < 32 || isPlaceholderOrWeakSecret(secret)) {
    throw new MissingOrWeakSecretError(
      "AUTH_SECRET",
      "AUTH_SECRET ausente ou inseguro. Configure um segredo criptográfico com no mínimo 32 caracteres de alta entropia."
    );
  }
  return secret;
}

/**
 * Requires a valid OAuth state signing secret (`OAUTH_STATE_SIGNING_SECRET` or `AUTH_SECRET`).
 * Strictly zero hardcoded fallback secrets.
 */
export function requireOAuthStateSigningSecret(
  rawEnv: Record<string, string | undefined> = process.env
): string {
  const candidate =
    rawEnv.OAUTH_STATE_SIGNING_SECRET?.trim() ||
    rawEnv.AUTH_SECRET?.trim() ||
    "";
  if (candidate.length < 32 || isPlaceholderOrWeakSecret(candidate)) {
    throw new MissingOrWeakSecretError(
      "OAUTH_STATE_SIGNING_SECRET",
      "OAUTH_STATE_SIGNING_SECRET (ou AUTH_SECRET) ausente ou inseguro para assinatura HMAC de estado OAuth 2.0."
    );
  }
  return candidate;
}

/**
 * Requires official Google Ads OAuth 2.0 credentials (`GOOGLE_ADS_CLIENT_ID` and `GOOGLE_ADS_CLIENT_SECRET`).
 * Fails closed if missing or placeholder.
 */
export function requireGoogleAdsOAuthConfig(
  rawEnv: Record<string, string | undefined> = process.env
): {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly stateSigningSecret: string;
  readonly appUrl: string;
} {
  const clientId = rawEnv.GOOGLE_ADS_CLIENT_ID?.trim() ?? "";
  const clientSecret = rawEnv.GOOGLE_ADS_CLIENT_SECRET?.trim() ?? "";

  if (!clientId || clientId.startsWith("replace_with_")) {
    throw new MissingOrWeakSecretError(
      "GOOGLE_ADS_CLIENT_ID",
      "GOOGLE_ADS_CLIENT_ID não está configurado com credenciais oficiais do Google Cloud."
    );
  }
  if (!clientSecret || clientSecret.startsWith("replace_with_")) {
    throw new MissingOrWeakSecretError(
      "GOOGLE_ADS_CLIENT_SECRET",
      "GOOGLE_ADS_CLIENT_SECRET não está configurado com credenciais oficiais do Google Cloud."
    );
  }

  const stateSigningSecret = requireOAuthStateSigningSecret(rawEnv);
  const appUrl = rawEnv.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";

  return {
    clientId,
    clientSecret,
    stateSigningSecret,
    appUrl,
  };
}
