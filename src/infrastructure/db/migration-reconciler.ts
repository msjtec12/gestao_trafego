import crypto from "crypto";
import fs from "fs";
import path from "path";

export interface DrizzleJournalEntry {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

export interface DrizzleJournalFile {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly DrizzleJournalEntry[];
}

export interface ResolvedMigrationDescriptor {
  readonly idx: number;
  readonly tag: string;
  readonly filename: string;
  readonly when: number;
  readonly hash: string;
  readonly sqlContent: string;
}

export interface MigrationSqlClient {
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<{ readonly rows: readonly TRow[] }>;
}

const DEFAULT_MIGRATIONS_DIR = path.resolve(
  process.cwd(),
  "drizzle/migrations"
);

/**
 * Reads the official Drizzle journal (`drizzle/migrations/meta/_journal.json`)
 * and computes the exact SHA-256 hash used by `drizzle-orm` migrator
 * (`drizzle.__drizzle_migrations.hash`) for each migration file.
 */
export function loadOfficialDrizzleMigrations(
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR
): readonly ResolvedMigrationDescriptor[] {
  const journalPath = path.join(migrationsDir, "meta", "_journal.json");
  const rawJournal = fs.readFileSync(journalPath, "utf8");
  const journal = JSON.parse(rawJournal) as DrizzleJournalFile;

  return journal.entries.map((entry) => {
    const filename = `${entry.tag}.sql`;
    const fullPath = path.join(migrationsDir, filename);
    const sqlContent = fs.readFileSync(fullPath, "utf8");
    const hash = crypto
      .createHash("sha256")
      .update(sqlContent, "utf8")
      .digest("hex");

    return {
      idx: entry.idx,
      tag: entry.tag,
      filename,
      when: entry.when,
      hash,
      sqlContent,
    };
  });
}

/**
 * Reconciles the legacy `_konnexy_migrations` table with Drizzle's official
 * `drizzle.__drizzle_migrations` tracking table WITHOUT re-executing any
 * migration file that has already been applied in either table.
 *
 * Non-destructive guarantees:
 * - Never drops tables or deletes rows.
 * - Any file present in `_konnexy_migrations` is backfilled into
 *   `drizzle.__drizzle_migrations` with its exact SHA-256 hash and `when` timestamp.
 * - Any hash present in `drizzle.__drizzle_migrations` is backfilled into
 *   `_konnexy_migrations` for backward compatibility.
 * - Returns the list of reconciled filenames and pending migrations (if any).
 */
export async function reconcileMigrationTrackingTables(
  client: MigrationSqlClient,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR
): Promise<{
  readonly reconciledIntoDrizzle: readonly string[];
  readonly reconciledIntoLegacy: readonly string[];
  readonly alreadyAppliedFilenames: readonly string[];
  readonly pendingFilenames: readonly string[];
}> {
  const descriptors = loadOfficialDrizzleMigrations(migrationsDir);

  await client.query(`
    CREATE TABLE IF NOT EXISTS "_konnexy_migrations" (
      "filename" varchar(255) PRIMARY KEY NOT NULL,
      "applied_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);
  await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle";`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      "id" serial PRIMARY KEY,
      "hash" text NOT NULL,
      "created_at" bigint
    );
  `);

  const legacyRows = await client.query<{ filename: string }>(
    `SELECT "filename" FROM "_konnexy_migrations"`
  );
  const drizzleRows = await client.query<{ hash: string; created_at: string | number | null }>(
    `SELECT "hash", "created_at" FROM "drizzle"."__drizzle_migrations"`
  );

  const legacySet = new Set(legacyRows.rows.map((r) => r.filename));
  const drizzleHashSet = new Set(drizzleRows.rows.map((r) => r.hash));

  const reconciledIntoDrizzle: string[] = [];
  const reconciledIntoLegacy: string[] = [];
  const alreadyAppliedFilenames: string[] = [];
  const pendingFilenames: string[] = [];

  for (const mig of descriptors) {
    const inLegacy = legacySet.has(mig.filename);
    const inDrizzle = drizzleHashSet.has(mig.hash);

    if (inLegacy && !inDrizzle) {
      await client.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`,
        [mig.hash, mig.when]
      );
      drizzleHashSet.add(mig.hash);
      reconciledIntoDrizzle.push(mig.filename);
      alreadyAppliedFilenames.push(mig.filename);
    } else if (inDrizzle && !inLegacy) {
      await client.query(
        `INSERT INTO "_konnexy_migrations" ("filename") VALUES ($1) ON CONFLICT ("filename") DO NOTHING`,
        [mig.filename]
      );
      legacySet.add(mig.filename);
      reconciledIntoLegacy.push(mig.filename);
      alreadyAppliedFilenames.push(mig.filename);
    } else if (inLegacy && inDrizzle) {
      alreadyAppliedFilenames.push(mig.filename);
    } else {
      pendingFilenames.push(mig.filename);
    }
  }

  return {
    reconciledIntoDrizzle,
    reconciledIntoLegacy,
    alreadyAppliedFilenames,
    pendingFilenames,
  };
}

/**
 * Generates an idempotent, non-destructive SQL reconciliation script that
 * operators can run once on Neon staging/production databases where migrations
 * `0000`..`0003` were already applied via `_konnexy_migrations` before running
 * `drizzle-kit migrate` for `0004` and future migrations.
 */
export function generateDrizzleReconciliationSql(
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
  onlyTags?: readonly string[]
): string {
  const descriptors = loadOfficialDrizzleMigrations(migrationsDir).filter((m) =>
    onlyTags ? onlyTags.includes(m.tag) : true
  );

  const lines: string[] = [
    "-- Konnexy Ads: Non-destructive reconciliation of _konnexy_migrations -> drizzle.__drizzle_migrations",
    "-- Never drops tables or re-applies already executed migrations.",
    'CREATE SCHEMA IF NOT EXISTS "drizzle";',
    'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" ("id" serial PRIMARY KEY, "hash" text NOT NULL, "created_at" bigint);',
  ];

  for (const m of descriptors) {
    lines.push(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") SELECT '${m.hash}', ${m.when} WHERE EXISTS (SELECT 1 FROM "_konnexy_migrations" WHERE "filename" = '${m.filename}') AND NOT EXISTS (SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE "hash" = '${m.hash}');`
    );
  }

  return lines.join("\n");
}
