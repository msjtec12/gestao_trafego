-- ============================================================================
-- KONNEXY ADS — MIGRATION 0004: DYNAMIC POSTGRESQL 17 SET ROLE GRANT,
-- LEAST-PRIVILEGE OPERATIONAL CONNECTION ROLE & DRIZZLE JOURNAL RECONCILIATION
-- ============================================================================
-- Idempotent and non-destructive:
-- - Does NOT drop tables or alter existing data.
-- - Resolves SQLSTATE 42501 ("permission denied to set role konnexy_app") on
--   Neon PostgreSQL 17 without hardcoding the database owner role name across
--   environments (staging, production, preview branches, local/PGlite).
-- - Provisions least-privilege operational connection role `konnexy_runtime`
--   (LOGIN-capable when password is set via secret manager, NOBYPASSRLS,
--   NOSUPERUSER, granted SET-only membership in `konnexy_app` with INHERIT FALSE).
-- ============================================================================

-- 1. Ensure konnexy_app role exists (least-privilege RLS-enforced execution role)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konnexy_app') THEN
    CREATE ROLE konnexy_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint

-- 2. Dynamically grant SET TRUE, INHERIT FALSE on konnexy_app to current_user
--    (works for konnexy_ads_owner, neondb_owner, staging owners, or postgres
--    without hardcoding owner role names). Compatible with PG 16/17+ and PG <= 15.
DO $$
DECLARE
  v_current_role text := current_user;
  v_pg_version_num integer := current_setting('server_version_num')::integer;
BEGIN
  IF v_current_role IS NOT NULL AND v_current_role <> 'konnexy_app' THEN
    IF v_pg_version_num >= 160000 THEN
      EXECUTE format(
        'GRANT konnexy_app TO %I WITH SET TRUE, INHERIT FALSE',
        v_current_role
      );
    ELSE
      EXECUTE format('GRANT konnexy_app TO %I', v_current_role);
    END IF;
  END IF;
END
$$;
--> statement-breakpoint

-- 3. Provision least-privilege operational connection role `konnexy_runtime`
--    (Dedicated runtime connector role: NOINHERIT, NOBYPASSRLS, NOSUPERUSER,
--    NOCREATEDB, NOCREATEROLE; allowed to execute SET LOCAL ROLE konnexy_app
--    inside tenant transactions, without owning schema objects).
--    NOTE: Password assignment for LOGIN must be performed out-of-band via
--    Neon Console / Secret Manager (never hardcoded in SQL migrations).
DO $$
DECLARE
  v_pg_version_num integer := current_setting('server_version_num')::integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konnexy_runtime') THEN
    CREATE ROLE konnexy_runtime NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;

  GRANT USAGE ON SCHEMA public TO konnexy_runtime;

  IF v_pg_version_num >= 160000 THEN
    EXECUTE 'GRANT konnexy_app TO konnexy_runtime WITH SET TRUE, INHERIT FALSE';
  ELSE
    EXECUTE 'GRANT konnexy_app TO konnexy_runtime';
  END IF;
END
$$;
--> statement-breakpoint

-- 4. Grant minimal direct auth/session lookup privileges to konnexy_runtime
--    so withAdminPostgresConnection can authenticate users & sessions without
--    requiring database-owner privileges, while all tenant operations run via
--    SET LOCAL ROLE konnexy_app (FORCE ROW LEVEL SECURITY).
GRANT SELECT, INSERT, UPDATE ON TABLE
  "users",
  "organizations",
  "memberships",
  "member_client_access",
  "user_sessions",
  "auth_rate_limits"
TO konnexy_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "audit_logs" TO konnexy_runtime;
--> statement-breakpoint

-- 5. Ensure official Drizzle migration tracking table exists so legacy
--    _konnexy_migrations entries can be reconciled without re-applying SQL.
CREATE SCHEMA IF NOT EXISTS "drizzle";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  "id" serial PRIMARY KEY,
  "hash" text NOT NULL,
  "created_at" bigint
);
