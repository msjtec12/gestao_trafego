-- ============================================================================
-- KONNEXY ADS — STAGE 2.0: OPTIONAL COMPOSITE FKS, PER-TABLE GRANTS,
-- PAYLOAD-BOUND APPROVALS, CLIENT_VIEWER ACCESS & SYNC CHECKPOINTS
-- ============================================================================

-- 1. Create enum for sync_runs
CREATE TYPE "public"."sync_run_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED_CONCURRENT_LOCK');
--> statement-breakpoint

-- 2. Alter existing tables for Stage 2 capabilities
ALTER TABLE "users" ADD COLUMN "password_hash" text;
--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "manager_customer_id" varchar(64);
--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "encryption_key_version" varchar(16) DEFAULT 'v1' NOT NULL;
--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "revoked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "manager_customer_id" varchar(64);
--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "is_mcc_account" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "is_selected_for_sync" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "action_payload_hash" varchar(64) DEFAULT 'legacy_unhashed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "approvals" ALTER COLUMN "action_payload_hash" DROP DEFAULT;
--> statement-breakpoint

-- 3. Complete composite foreign keys on optional relationships (Phase 1 fix)
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_org_ad_group_fk"
  FOREIGN KEY ("organization_id", "ad_group_id")
  REFERENCES "public"."ad_groups"("organization_id", "id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "budgets" ADD CONSTRAINT "budgets_org_campaign_fk"
  FOREIGN KEY ("organization_id", "campaign_id")
  REFERENCES "public"."campaigns"("organization_id", "id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_org_campaign_fk"
  FOREIGN KEY ("organization_id", "campaign_id")
  REFERENCES "public"."campaigns"("organization_id", "id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- 4. Create member_client_access table (CLIENT_VIEWER granular scope)
CREATE TABLE "member_client_access" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE cascade,
  "membership_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_client_access_org_id_unique" ON "member_client_access" USING btree ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "member_client_access_org_member_client_idx" ON "member_client_access" USING btree ("organization_id", "membership_id", "client_id");
--> statement-breakpoint
ALTER TABLE "member_client_access" ADD CONSTRAINT "member_client_access_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id")
  REFERENCES "public"."memberships"("organization_id", "id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_client_access" ADD CONSTRAINT "member_client_access_org_client_fk"
  FOREIGN KEY ("organization_id", "client_id")
  REFERENCES "public"."clients"("organization_id", "id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "member_client_access" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "member_client_access" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_member_client_access_tenant_isolation" ON "member_client_access"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

-- 5. Create sync_runs table (Incremental Sync History & Checkpoints)
CREATE TABLE "sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE cascade,
  "integration_id" uuid NOT NULL,
  "ad_account_id" uuid,
  "provider" "ad_provider" NOT NULL,
  "status" "sync_run_status" DEFAULT 'RUNNING' NOT NULL,
  "checkpoint_token" varchar(255),
  "entities_synced" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_code" varchar(80),
  "error_message" text,
  "is_demo_data" boolean DEFAULT false NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_org_id_unique" ON "sync_runs" USING btree ("organization_id", "id");
--> statement-breakpoint
CREATE INDEX "sync_runs_org_integration_idx" ON "sync_runs" USING btree ("organization_id", "integration_id");
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_org_integration_fk"
  FOREIGN KEY ("organization_id", "integration_id")
  REFERENCES "public"."integrations"("organization_id", "id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_org_ad_account_fk"
  FOREIGN KEY ("organization_id", "ad_account_id")
  REFERENCES "public"."ad_accounts"("organization_id", "id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sync_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_sync_runs_tenant_isolation" ON "sync_runs"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

-- 6. Restrict PostgreSQL privileges per table for konnexy_app (Phase 1 fix)
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM konnexy_app;
--> statement-breakpoint

-- Append-only tables: SELECT and INSERT only (NO UPDATE, NO DELETE)
GRANT SELECT, INSERT ON TABLE
  "audit_logs",
  "automation_runs",
  "daily_metrics",
  "search_terms"
TO konnexy_app;
--> statement-breakpoint

-- Operational tables without hard delete from application role: SELECT, INSERT, UPDATE
GRANT SELECT, INSERT, UPDATE ON TABLE
  "organizations",
  "users",
  "memberships",
  "clients",
  "integrations",
  "ad_accounts",
  "campaigns",
  "ad_groups",
  "ads",
  "keywords",
  "conversions",
  "budgets",
  "recommendations",
  "automation_rules",
  "approvals",
  "execution_jobs",
  "reports",
  "notifications",
  "sync_runs"
TO konnexy_app;
--> statement-breakpoint

-- Join assignment table allowing revocation of client access
GRANT SELECT, INSERT, DELETE ON TABLE "member_client_access" TO konnexy_app;
