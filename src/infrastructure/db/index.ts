import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function createDbClient(connectionString?: string) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not configured. Copy .env.example to .env.local and configure Neon PostgreSQL."
    );
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export type DatabaseClient = ReturnType<typeof createDbClient>;
