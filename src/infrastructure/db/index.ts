import fs from "fs";
import path from "path";
import { neon, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import {
  drizzle as drizzleServerless,
  type NeonDatabase,
} from "drizzle-orm/neon-serverless";
import {
  drizzle as drizzlePglite,
  type PgliteDatabase,
} from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import type { TenantContext } from "@/domain/types";
import { UnauthenticatedAccessError } from "@/security/session-guard";
import * as schema from "./schema";

export type SchemaType = typeof schema;

/**
 * Strongly typed Drizzle PostgreSQL executor compatible with both the official
 * Neon serverless driver (`NeonDatabase` / `NeonHttpDatabase`), `PgliteDatabase` (in explicit
 * test/dev mode), and PostgreSQL transaction handles (`PgTransaction`).
 * Eliminates all `any` types and `eslint-disable` directives across repositories and transactions.
 */
export type DrizzleQueryExecutor = Pick<
  NeonDatabase<SchemaType>,
  "select" | "insert" | "update" | "delete" | "execute"
>;

export type OperationalDrizzleDb =
  | NeonDatabase<SchemaType>
  | NeonHttpDatabase<SchemaType>
  | PgliteDatabase<SchemaType>
  | DrizzleQueryExecutor;

export class DatabaseConfigurationError extends Error {
  public readonly code = "DATABASE_CONFIGURATION_ERROR";
  public readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertValidOrganizationUuid(organizationId: string): void {
  if (!UUID_V4_REGEX.test(organizationId)) {
    throw new Error(
      `Invalid organization_id UUID format for RLS context: '${organizationId}'.`
    );
  }
}

export function assertAuthenticatedDbContext(
  context: TenantContext | null | undefined
): TenantContext {
  if (!context || !context.userId?.trim() || !context.organizationId?.trim()) {
    throw new UnauthenticatedAccessError(
      "Database access denied: authenticated TenantContext with valid userId and organizationId is mandatory."
    );
  }
  assertValidOrganizationUuid(context.organizationId);
  return context;
}

export function isLiveNeonConnectionConfigured(url?: string): boolean {
  const target = (url ?? process.env.DATABASE_URL ?? "").trim();
  if (!target.startsWith("postgresql://") && !target.startsWith("postgres://")) {
    return false;
  }
  if (
    target.includes("replace_with_password") ||
    target.includes("localhost:5432/konnexy_ads") ||
    target.includes("ep-example")
  ) {
    return false;
  }
  return true;
}

/**
 * Checks whether local/test PGlite is explicitly permitted.
 * INVARIANT (Stage 2.2 P0):
 * - In Vercel or cloud production (`VERCEL === "1"` or `NODE_ENV === "production"` without explicit
 *   local E2E flag `KONNEXY_ALLOW_PGLITE_DEV === "true"`), PGlite is NEVER allowed.
 * - On Vercel (`VERCEL === "1"`), PGlite is unconditionally forbidden even if `KONNEXY_ALLOW_PGLITE_DEV` is set.
 */
export function isExplicitPgliteTestOrDevAllowed(
  rawEnv: Record<string, string | undefined> = process.env
): boolean {
  if (rawEnv.VERCEL === "1" || Boolean(rawEnv.VERCEL_ENV)) {
    return false;
  }
  if (rawEnv.KONNEXY_ALLOW_PGLITE_DEV === "true") {
    return true;
  }
  if (rawEnv.NODE_ENV === "test") {
    return true;
  }
  return false;
}

/**
 * Validates `DATABASE_URL` before any database operation starts.
 * Fails closed with `DatabaseConfigurationError` if Neon is required and not configured.
 */
export function validateRequiredDatabaseUrl(options?: {
  readonly connectionString?: string;
  readonly allowExplicitPglite?: boolean;
}): {
  readonly mode: "NEON" | "PGLITE_DEV_TEST";
  readonly connectionString: string | null;
} {
  const url = (options?.connectionString ?? process.env.DATABASE_URL ?? "").trim();

  if (isLiveNeonConnectionConfigured(url)) {
    return { mode: "NEON", connectionString: url };
  }

  const canUsePglite =
    (options?.allowExplicitPglite ?? true) &&
    isExplicitPgliteTestOrDevAllowed(process.env);

  if (canUsePglite) {
    return { mode: "PGLITE_DEV_TEST", connectionString: null };
  }

  throw new DatabaseConfigurationError(
    "Neon PostgreSQL (DATABASE_URL) é obrigatório em produção e não está configurado ou contém credenciais de placeholder. Nenhum fallback silencioso para PGlite é permitido."
  );
}

export function createDbClient(connectionString?: string): NeonHttpDatabase<SchemaType> {
  const validated = validateRequiredDatabaseUrl({
    connectionString,
    allowExplicitPglite: false,
  });
  if (!validated.connectionString) {
    throw new DatabaseConfigurationError(
      "DATABASE_URL is not configured for Neon HTTP client."
    );
  }
  const client = neon(validated.connectionString);
  return drizzleHttp(client, { schema });
}

export type DatabaseClient = ReturnType<typeof createDbClient>;

const MIGRATION_FILES = [
  "0000_confused_galactus.sql",
  "0001_multi_tenant_rls_hardening.sql",
  "0002_stage2_auth_rls_and_sync.sql",
  "0003_stage2_1_operational_persistence.sql",
] as const;

export async function applyAllMigrationsToPglite(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS "_konnexy_migrations" (
      "filename" varchar(255) PRIMARY KEY NOT NULL,
      "applied_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);

  for (const filename of MIGRATION_FILES) {
    const check = await pg.query<{ filename: string }>(
      `SELECT filename FROM "_konnexy_migrations" WHERE filename = $1`,
      [filename]
    );
    if (check.rows.length > 0) {
      continue;
    }

    const fullPath = path.resolve(
      process.cwd(),
      "drizzle/migrations",
      filename
    );
    const sqlContent = fs.readFileSync(fullPath, "utf8");
    await pg.exec(sqlContent);
    await pg.query(
      `INSERT INTO "_konnexy_migrations" (filename) VALUES ($1)`,
      [filename]
    );
  }
}

/**
 * Applies all SQL migrations to a live Neon PostgreSQL database using a Pool connection.
 * Used exclusively by authorized disposable Neon integration test suites or migration runners.
 */
export async function applyAllMigrationsToNeonPool(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "_konnexy_migrations" (
      "filename" varchar(255) PRIMARY KEY NOT NULL,
      "applied_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);

  for (const filename of MIGRATION_FILES) {
    const check = await pool.query<{ filename: string }>(
      `SELECT filename FROM "_konnexy_migrations" WHERE filename = $1`,
      [filename]
    );
    if (check.rows.length > 0) {
      continue;
    }

    const fullPath = path.resolve(
      process.cwd(),
      "drizzle/migrations",
      filename
    );
    const sqlContent = fs.readFileSync(fullPath, "utf8");
    await pool.query(sqlContent);
    await pool.query(
      `INSERT INTO "_konnexy_migrations" (filename) VALUES ($1)`,
      [filename]
    );
  }
}

declare global {
  var __konnexyTestDevPgInstance: PGlite | undefined;
  var __konnexyTestDevPgPromise:
    | Promise<{ pg: PGlite; db: PgliteDatabase<SchemaType> }>
    | undefined;
}

async function getExplicitTestOrDevPglite(
  customDataDir?: string
): Promise<{
  readonly pg: PGlite;
  readonly db: PgliteDatabase<SchemaType>;
}> {
  if (!isExplicitPgliteTestOrDevAllowed(process.env)) {
    throw new DatabaseConfigurationError(
      "PGlite is strictly forbidden outside explicit test/dev environments."
    );
  }

  if (globalThis.__konnexyTestDevPgPromise && !customDataDir) {
    return await globalThis.__konnexyTestDevPgPromise;
  }

  const initPromise = (async () => {
    const dataDir =
      customDataDir ??
      process.env.KONNEXY_PG_DATA_DIR ??
      "memory://";

    if (dataDir !== "memory://") {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const pg = dataDir === "memory://" ? new PGlite() : new PGlite(dataDir);
    await applyAllMigrationsToPglite(pg);
    const db = drizzlePglite(pg, { schema });
    globalThis.__konnexyTestDevPgInstance = pg;
    return { pg, db };
  })();

  if (!customDataDir) {
    globalThis.__konnexyTestDevPgPromise = initPromise;
  }

  return await initPromise;
}

/**
 * Executes an administrative database operation (Authentication lookup, Onboarding,
 * Session resolution/revocation, or OAuth state pre-check) before or during TenantContext resolution.
 *
 * - In Production / Live Neon: connects via official Neon Serverless `Pool` (`DATABASE_ADMIN_URL` or `DATABASE_URL`)
 *   and cleanly closes the pool in `finally`.
 * - In Explicit Test / Dev (`NODE_ENV=test` or `KONNEXY_ALLOW_PGLITE_DEV=true`): runs against the
 *   explicit test/dev PGlite instance.
 * - Never falls back to PGlite in production.
 */
export async function withAdminPostgresConnection<T>(
  callback: (db: DrizzleQueryExecutor) => Promise<T>,
  options?: {
    readonly connectionString?: string;
    readonly customPg?: PGlite;
    readonly forceNeonDriver?: boolean;
    readonly neonPoolFactory?: (connStr: string) => Pool;
  }
): Promise<T> {
  if (options?.customPg) {
    if (!isExplicitPgliteTestOrDevAllowed(process.env)) {
      throw new DatabaseConfigurationError(
        "customPg is not allowed in production."
      );
    }
    const db = drizzlePglite(options.customPg, { schema }) as unknown as DrizzleQueryExecutor;
    return await callback(db);
  }

  const adminUrl =
    options?.connectionString ??
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL;

  const validated = validateRequiredDatabaseUrl({
    connectionString: adminUrl,
    allowExplicitPglite: !options?.forceNeonDriver,
  });

  if (options?.forceNeonDriver || validated.mode === "NEON") {
    const connStr = validated.connectionString ?? adminUrl ?? "";
    if (!connStr) {
      throw new DatabaseConfigurationError(
        "DATABASE_URL is required for Neon administrative connection."
      );
    }
    const pool = options?.neonPoolFactory
      ? options.neonPoolFactory(connStr)
      : new Pool({ connectionString: connStr });
    const db = drizzleServerless(pool, { schema });

    try {
      return await callback(db);
    } finally {
      await pool.end();
    }
  }

  const runtime = await getExplicitTestOrDevPglite();
  return await callback(runtime.db as unknown as DrizzleQueryExecutor);
}

/**
 * Executes an operational tenant-scoped database callback inside an explicit PostgreSQL
 * transaction protected by an authenticated `TenantContext`:
 *   1. `SET LOCAL ROLE konnexy_app` (least-privilege role with `NOBYPASSRLS`)
 *   2. `SELECT set_config('app.current_organization_id', context.organizationId, true)`
 *
 * CRITICAL SECURITY INVARIANT (Stage 2.2 P0 & P1):
 * - Accepts ONLY an authenticated `TenantContext` object (isolated `organizationId` strings are rejected).
 * - Requires Neon in production (zero silent fallback to PGlite).
 * - Strongly typed `DrizzleQueryExecutor` callback (zero `any`).
 */
export async function withTenantTransaction<T>(
  context: TenantContext,
  callback: (tx: DrizzleQueryExecutor) => Promise<T>,
  options?: {
    readonly connectionString?: string;
    readonly customPg?: PGlite;
    readonly forceNeonDriver?: boolean;
    readonly neonPoolFactory?: (connStr: string) => Pool;
  }
): Promise<T> {
  const authCtx = assertAuthenticatedDbContext(context);
  const organizationId = authCtx.organizationId;

  if (options?.customPg) {
    if (!isExplicitPgliteTestOrDevAllowed(process.env)) {
      throw new DatabaseConfigurationError(
        "customPg is not allowed in production."
      );
    }
    const pgliteDb = drizzlePglite(options.customPg, { schema });
    return await pgliteDb.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE konnexy_app`);
      await tx.execute(
        sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`
      );
      return await callback(tx as unknown as DrizzleQueryExecutor);
    });
  }

  const url = options?.connectionString ?? process.env.DATABASE_URL;
  const validated = validateRequiredDatabaseUrl({
    connectionString: url,
    allowExplicitPglite: !options?.forceNeonDriver,
  });

  if (options?.forceNeonDriver || validated.mode === "NEON") {
    const connStr = validated.connectionString ?? url ?? "";
    if (!connStr) {
      throw new DatabaseConfigurationError(
        "DATABASE_URL is required for Neon tenant transaction."
      );
    }
    const pool = options?.neonPoolFactory
      ? options.neonPoolFactory(connStr)
      : new Pool({ connectionString: connStr });
    const db = drizzleServerless(pool, { schema });

    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE konnexy_app`);
        await tx.execute(
          sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`
        );
        return await callback(tx);
      });
    } finally {
      await pool.end();
    }
  }

  const runtime = await getExplicitTestOrDevPglite();
  return await runtime.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE konnexy_app`);
    await tx.execute(
      sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`
    );
    return await callback(tx as unknown as DrizzleQueryExecutor);
  });
}
