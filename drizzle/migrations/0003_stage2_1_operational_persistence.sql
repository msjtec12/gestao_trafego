-- ============================================================================
-- KONNEXY ADS — STAGE 2.1: OPERATIONAL PERSISTENCE (SESSIONS, DURABLE RATE LIMIT,
-- SINGLE-USE OAUTH STATES, 9-DOMAIN IDEMPOTENT UPSERT INDEXES & SYNC LOCKS)
-- ============================================================================

-- 1. Persistent user_sessions table
CREATE TABLE IF NOT EXISTS "user_sessions" (
  "session_token" varchar(128) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "active_organization_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE cascade,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");
--> statement-breakpoint

-- 2. Durable PostgreSQL auth_rate_limits table
CREATE TABLE IF NOT EXISTS "auth_rate_limits" (
  "identifier" varchar(255) PRIMARY KEY NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "first_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_until" timestamp with time zone
);
--> statement-breakpoint

-- 3. Persistent single-use oauth_states table with RLS
CREATE TABLE IF NOT EXISTS "oauth_states" (
  "nonce" varchar(128) PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "provider" "ad_provider" NOT NULL,
  "code_verifier" varchar(255) NOT NULL,
  "redirect_uri" text NOT NULL,
  "consumed_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_states_org_user_idx" ON "oauth_states" USING btree ("organization_id", "user_id");
--> statement-breakpoint
ALTER TABLE "oauth_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_states" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_oauth_states_tenant_isolation" ON "oauth_states"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

-- 4. Add last_checkpoint_token to integrations
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "last_checkpoint_token" varchar(255);
--> statement-breakpoint

-- 5. Add composite unique indexes for idempotent 9-domain upserts
CREATE UNIQUE INDEX IF NOT EXISTS "ad_groups_org_camp_ext_idx"
  ON "ad_groups" USING btree ("organization_id", "campaign_id", "external_ad_group_id");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ads_org_adgroup_ext_idx"
  ON "ads" USING btree ("organization_id", "ad_group_id", "external_ad_id");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "keywords_org_adgroup_ext_idx"
  ON "keywords" USING btree ("organization_id", "ad_group_id", "external_keyword_id");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "search_terms_org_camp_term_date_idx"
  ON "search_terms" USING btree ("organization_id", "campaign_id", "search_term", "observed_date");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "conversions_org_acc_ext_idx"
  ON "conversions" USING btree ("organization_id", "ad_account_id", "external_conversion_id");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "budgets_org_client_period_unique_idx"
  ON "budgets" USING btree ("organization_id", "client_id", "period_month");
--> statement-breakpoint

-- 6. Grant table-specific permissions to konnexy_app for operational persistence
GRANT SELECT, INSERT, UPDATE ON TABLE
  "user_sessions",
  "auth_rate_limits",
  "oauth_states",
  "daily_metrics",
  "search_terms"
TO konnexy_app;
