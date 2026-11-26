import fs from "fs";
import path from "path";
import { neon, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import type { TenantContext } from "@/domain/types";
import { UnauthenticatedAccessError } from "@/security/session-guard";
import * as schema from "./schema";

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
  const target = url ?? process.env.DATABASE_URL ?? "";
  if (!target.startsWith("postgresql://") && !target.startsWith("postgres://")) {
    return false;
  }
  if (
    target.includes("replace_with_password") ||
    target.includes("localhost:5432/konnexy_ads")
  ) {
    return false;
  }
  return true;
}

export function createDbClient(connectionString?: string) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not configured. Copy .env.example to .env.local and configure Neon PostgreSQL."
    );
  }
  const client = neon(url);
  return drizzleHttp(client, { schema });
}

export type DatabaseClient = ReturnType<typeof createDbClient>;
export type OperationalDrizzleDb = PgliteDatabase<typeof schema>;

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

declare global {
  var __konnexyPersistentPgInstance: PGlite | undefined;
  var __konnexyPersistentPgPromise:
    | Promise<{ pg: PGlite; db: OperationalDrizzleDb }>
    | undefined;
}

/**
 * Returns the persistent PostgreSQL instance.
 * - When `KONNEXY_PG_DATA_DIR` or default `.data/konnexy-pgdata` is used in local/E2E,
 *   all tables, migrations, users, clients, integrations, and sync runs persist on disk across
 *   server restarts and page reloads.
 */
export async function getOperationalPostgresRuntime(
  customDataDir?: string
): Promise<{
  readonly pg: PGlite;
  readonly db: OperationalDrizzleDb;
}> {
  if (globalThis.__konnexyPersistentPgPromise && !customDataDir) {
    return await globalThis.__konnexyPersistentPgPromise;
  }

  const initPromise = (async () => {
    const dataDir =
      customDataDir ??
      process.env.KONNEXY_PG_DATA_DIR ??
      path.resolve(process.cwd(), ".data/konnexy-pgdata");

    if (dataDir !== "memory://") {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const pg =
      dataDir === "memory://" ? new PGlite() : new PGlite(dataDir);
    await applyAllMigrationsToPglite(pg);
    const db = drizzlePglite(pg, { schema });
    globalThis.__konnexyPersistentPgInstance = pg;
    return { pg, db };
  })();

  if (!customDataDir) {
    globalThis.__konnexyPersistentPgPromise = initPromise;
  }

  return await initPromise;
}

/**
 * Executes a callback inside an explicit PostgreSQL transaction protected by an
 * authenticated TenantContext (`SET LOCAL ROLE konnexy_app` +
 * `SELECT set_config('app.current_organization_id', context.organizationId, true)`).
 *
 * Uses the Neon serverless Pool driver when a live Neon connection string is provided,
 * or the persistent operational PostgreSQL engine in local/test environments.
 */
export async function withTenantTransaction<T>(
  contextOrOrgId: TenantContext | string,
  callback: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any
  ) => Promise<T>,
  options?: {
    readonly connectionString?: string;
    readonly customPg?: PGlite;
    readonly forceNeonDriver?: boolean;
    readonly neonPoolFactory?: (connStr: string) => Pool;
  }
): Promise<T> {
  const organizationId =
    typeof contextOrOrgId === "string"
      ? contextOrOrgId
      : assertAuthenticatedDbContext(contextOrOrgId).organizationId;

  assertValidOrganizationUuid(organizationId);
  const url = options?.connectionString ?? process.env.DATABASE_URL;

  if (
    options?.forceNeonDriver ||
    (!options?.customPg && isLiveNeonConnectionConfigured(url))
  ) {
    if (!url) {
      throw new Error("DATABASE_URL is required for Neon transaction.");
    }
    const pool = options?.neonPoolFactory
      ? options.neonPoolFactory(url)
      : new Pool({ connectionString: url });
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

  const runtime = options?.customPg
    ? {
        pg: options.customPg,
        db: drizzlePglite(options.customPg, { schema }),
      }
    : await getOperationalPostgresRuntime();

  return await runtime.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE konnexy_app`);
    await tx.execute(
      sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`
    );
    return await callback(tx);
  });
}
