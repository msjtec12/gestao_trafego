import { z } from "zod";

const DEMO_SECRET_PATTERNS = [
  /^replace_with_/i,
  /^sk-replace_with_/i,
  /^0{16,}$/,
  /^1{16,}$/,
  /^f{16,}$/i,
  /^example/i,
  /^changeme/i,
];

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
    AUTH_SECRET: z.string().min(32),
    CREDENTIALS_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "Must be a 64-character hex key (256 bits)"),
    CREDENTIALS_ENCRYPTION_KEY_VERSION: z
      .string()
      .regex(/^v[1-9][0-9]*$/)
      .default("v1"),
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
    if (env.NODE_ENV === "production") {
      if (isPlaceholderOrWeakSecret(env.AUTH_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["AUTH_SECRET"],
          message:
            "Production environment rejected demonstration or low-entropy AUTH_SECRET.",
        });
      }
      if (isPlaceholderOrWeakSecret(env.CREDENTIALS_ENCRYPTION_KEY)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CREDENTIALS_ENCRYPTION_KEY"],
          message:
            "Production environment rejected demonstration or all-zero CREDENTIALS_ENCRYPTION_KEY.",
        });
      }
      if (env.DATABASE_URL.includes("replace_with_password")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["DATABASE_URL"],
          message:
            "Production environment rejected placeholder DATABASE_URL credentials.",
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
