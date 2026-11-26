import { neon, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
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

/**
 * Executes a callback inside an explicit PostgreSQL transaction with
 * `SET LOCAL app.current_organization_id = <organizationId>` and
 * `SET LOCAL ROLE konnexy_app` so that Neon Connection Pooler (PgBouncer)
 * cannot leak tenant context across pooled requests.
 */
export async function withTenantTransaction<T>(
  organizationId: string,
  callback: (
    tx: Parameters<
      Parameters<ReturnType<typeof drizzleServerless>["transaction"]>[0]
    >[0]
  ) => Promise<T>,
  connectionString?: string
): Promise<T> {
  assertValidOrganizationUuid(organizationId);
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for withTenantTransaction.");
  }

  const pool = new Pool({ connectionString: url });
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
