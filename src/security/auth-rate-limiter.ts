import crypto from "crypto";
import { eq } from "drizzle-orm";
import type { DrizzleQueryExecutor } from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";

export interface RateLimitEntry {
  readonly attempts: number;
  readonly firstAttemptAtMs: number;
  readonly lockedUntilMs: number | null;
}

export class AuthAbuseRateLimiter {
  private readonly records = new Map<string, RateLimitEntry>();

  constructor(
    private readonly maxAttempts = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly lockoutDurationMs = 15 * 60 * 1000
  ) {}

  public checkAllowed(
    identifier: string,
    nowMs: number = Date.now()
  ): { readonly allowed: boolean; readonly retryAfterSeconds: number } {
    const key = identifier.trim().toLowerCase();
    const entry = this.records.get(key);
    if (!entry) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (entry.lockedUntilMs !== null && entry.lockedUntilMs > nowMs) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((entry.lockedUntilMs - nowMs) / 1000),
      };
    }

    if (nowMs - entry.firstAttemptAtMs > this.windowMs) {
      this.records.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  public recordFailedAttempt(
    identifier: string,
    nowMs: number = Date.now()
  ): { readonly locked: boolean; readonly remainingAttempts: number } {
    const key = identifier.trim().toLowerCase();
    const existing = this.records.get(key);

    if (!existing || nowMs - existing.firstAttemptAtMs > this.windowMs) {
      this.records.set(key, {
        attempts: 1,
        firstAttemptAtMs: nowMs,
        lockedUntilMs: null,
      });
      return { locked: false, remainingAttempts: this.maxAttempts - 1 };
    }

    const nextAttempts = existing.attempts + 1;
    const lockedUntilMs =
      nextAttempts >= this.maxAttempts ? nowMs + this.lockoutDurationMs : null;

    this.records.set(key, {
      attempts: nextAttempts,
      firstAttemptAtMs: existing.firstAttemptAtMs,
      lockedUntilMs,
    });

    return {
      locked: lockedUntilMs !== null,
      remainingAttempts: Math.max(0, this.maxAttempts - nextAttempts),
    };
  }

  public reset(identifier: string): void {
    this.records.delete(identifier.trim().toLowerCase());
  }
}

/**
 * Durable PostgreSQL-backed authentication rate limiter using the `auth_rate_limits` table.
 * Survives process restarts and works across serverless instances.
 */
export class PersistentPostgresAuthRateLimiter {
  constructor(
    private readonly db: DrizzleQueryExecutor,
    private readonly maxAttempts = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly lockoutDurationMs = 15 * 60 * 1000
  ) {}

  public async checkAllowed(
    identifier: string,
    nowMs: number = Date.now()
  ): Promise<{ readonly allowed: boolean; readonly retryAfterSeconds: number }> {
    const key = identifier.trim().toLowerCase();
    const rows: (typeof schema.authRateLimits.$inferSelect)[] = await this.db
      .select()
      .from(schema.authRateLimits)
      .where(eq(schema.authRateLimits.identifier, key));

    const entry = rows[0];
    if (!entry) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const lockedUntilMs = entry.lockedUntil
      ? new Date(entry.lockedUntil).getTime()
      : null;

    if (lockedUntilMs !== null && lockedUntilMs > nowMs) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((lockedUntilMs - nowMs) / 1000),
      };
    }

    const firstMs = new Date(entry.firstAttemptAt).getTime();
    if (nowMs - firstMs > this.windowMs) {
      await this.db
        .update(schema.authRateLimits)
        .set({
          attempts: 0,
          firstAttemptAt: new Date(nowMs),
          lockedUntil: null,
        })
        .where(eq(schema.authRateLimits.identifier, key));
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  public async recordFailedAttempt(
    identifier: string,
    nowMs: number = Date.now()
  ): Promise<{ readonly locked: boolean; readonly remainingAttempts: number }> {
    const key = identifier.trim().toLowerCase();
    const rows: (typeof schema.authRateLimits.$inferSelect)[] = await this.db
      .select()
      .from(schema.authRateLimits)
      .where(eq(schema.authRateLimits.identifier, key));

    const existing = rows[0];
    if (
      !existing ||
      existing.attempts === 0 ||
      nowMs - new Date(existing.firstAttemptAt).getTime() > this.windowMs
    ) {
      if (!existing) {
        await this.db.insert(schema.authRateLimits).values({
          identifier: key,
          attempts: 1,
          firstAttemptAt: new Date(nowMs),
          lockedUntil: null,
        });
      } else {
        await this.db
          .update(schema.authRateLimits)
          .set({
            attempts: 1,
            firstAttemptAt: new Date(nowMs),
            lockedUntil: null,
          })
          .where(eq(schema.authRateLimits.identifier, key));
      }
      return { locked: false, remainingAttempts: this.maxAttempts - 1 };
    }

    const nextAttempts = existing.attempts + 1;
    const lockedUntil =
      nextAttempts >= this.maxAttempts
        ? new Date(nowMs + this.lockoutDurationMs)
        : null;

    await this.db
      .update(schema.authRateLimits)
      .set({
        attempts: nextAttempts,
        lockedUntil,
      })
      .where(eq(schema.authRateLimits.identifier, key));

    return {
      locked: lockedUntil !== null,
      remainingAttempts: Math.max(0, this.maxAttempts - nextAttempts),
    };
  }

  public async reset(identifier: string): Promise<void> {
    const key = identifier.trim().toLowerCase();
    await this.db
      .update(schema.authRateLimits)
      .set({
        attempts: 0,
        lockedUntil: null,
      })
      .where(eq(schema.authRateLimits.identifier, key));
  }
}

export function hashPasswordScrypt(plainPassword: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(plainPassword, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPasswordScrypt(
  plainPassword: string,
  storedHash: string
): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(plainPassword, salt, 64);
  const expectedBuf = Buffer.from(expectedHex, "hex");
  if (derived.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(derived, expectedBuf);
}
