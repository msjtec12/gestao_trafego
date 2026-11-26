-- ============================================================================
-- KONNEXY ADS — FOUNDATION 1.1: MULTI-TENANT COMPOSITE FKS, RLS & AUDIT HARDENING
-- ============================================================================

-- 1. Drop single-column foreign keys that did not enforce same-organization ownership
ALTER TABLE "ad_accounts" DROP CONSTRAINT "ad_accounts_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "ad_accounts" DROP CONSTRAINT "ad_accounts_integration_id_integrations_id_fk";
--> statement-breakpoint
ALTER TABLE "ad_groups" DROP CONSTRAINT "ad_groups_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "ads" DROP CONSTRAINT "ads_ad_group_id_ad_groups_id_fk";
--> statement-breakpoint
ALTER TABLE "approvals" DROP CONSTRAINT "approvals_recommendation_id_recommendations_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_runs" DROP CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_runs" DROP CONSTRAINT "automation_runs_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_ad_account_id_ad_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "conversions" DROP CONSTRAINT "conversions_ad_account_id_ad_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "daily_metrics" DROP CONSTRAINT "daily_metrics_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "execution_jobs" DROP CONSTRAINT "execution_jobs_approval_id_approvals_id_fk";
--> statement-breakpoint
ALTER TABLE "execution_jobs" DROP CONSTRAINT "execution_jobs_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "keywords" DROP CONSTRAINT "keywords_ad_group_id_ad_groups_id_fk";
--> statement-breakpoint
ALTER TABLE "recommendations" DROP CONSTRAINT "recommendations_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "search_terms" DROP CONSTRAINT "search_terms_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "search_terms" DROP CONSTRAINT "search_terms_ad_group_id_ad_groups_id_fk";
--> statement-breakpoint
DROP INDEX "execution_jobs_idempotency_idx";
--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "campaign_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "retention_until" timestamp with time zone;
--> statement-breakpoint

-- 2. Create composite UNIQUE indexes (organization_id, id) MUST precede composite FKs
CREATE UNIQUE INDEX "ad_accounts_org_id_unique" ON "ad_accounts" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ad_groups_org_id_unique" ON "ad_groups" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ads_org_id_unique" ON "ads" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_org_id_unique" ON "approvals" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_logs_org_id_unique" ON "audit_logs" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rules_org_id_unique" ON "automation_rules" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_org_id_unique" ON "automation_runs" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_org_id_unique" ON "budgets" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_org_id_unique" ON "campaigns" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "clients_org_id_unique" ON "clients" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "conversions_org_id_unique" ON "conversions" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_metrics_org_id_unique" ON "daily_metrics" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "execution_jobs_org_id_unique" ON "execution_jobs" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "execution_jobs_org_idempotency_idx" ON "execution_jobs" USING btree ("organization_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_id_unique" ON "integrations" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "keywords_org_id_unique" ON "keywords" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_id_unique" ON "memberships" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_org_id_unique" ON "notifications" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_org_id_unique" ON "recommendations" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "reports_org_id_unique" ON "reports" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "search_terms_org_id_unique" ON "search_terms" USING btree ("organization_id","id");
--> statement-breakpoint

-- 3. Add composite foreign keys preventing cross-organization relational links
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_org_client_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_org_integration_fk" FOREIGN KEY ("organization_id","integration_id") REFERENCES "public"."integrations"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ad_groups" ADD CONSTRAINT "ad_groups_org_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_org_ad_group_fk" FOREIGN KEY ("organization_id","ad_group_id") REFERENCES "public"."ad_groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_org_recommendation_fk" FOREIGN KEY ("organization_id","recommendation_id") REFERENCES "public"."recommendations"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_org_rule_fk" FOREIGN KEY ("organization_id","rule_id") REFERENCES "public"."automation_rules"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_org_client_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_ad_account_fk" FOREIGN KEY ("organization_id","ad_account_id") REFERENCES "public"."ad_accounts"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_org_ad_account_fk" FOREIGN KEY ("organization_id","ad_account_id") REFERENCES "public"."ad_accounts"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_org_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_org_approval_fk" FOREIGN KEY ("organization_id","approval_id") REFERENCES "public"."approvals"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_org_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_org_ad_group_fk" FOREIGN KEY ("organization_id","ad_group_id") REFERENCES "public"."ad_groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_org_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_org_client_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_org_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- 4. Least-Privilege Application Role without BYPASSRLS
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'konnexy_app') THEN
    CREATE ROLE konnexy_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO konnexy_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO konnexy_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "audit_logs" FROM konnexy_app;
--> statement-breakpoint

-- 5. Enable & Force Row-Level Security (RLS) with USING and WITH CHECK across all operational tables
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_organizations_tenant_isolation" ON "organizations"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_memberships_tenant_isolation" ON "memberships"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_clients_tenant_isolation" ON "clients"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_integrations_tenant_isolation" ON "integrations"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "ad_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ad_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_ad_accounts_tenant_isolation" ON "ad_accounts"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_campaigns_tenant_isolation" ON "campaigns"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "ad_groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ad_groups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_ad_groups_tenant_isolation" ON "ad_groups"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "ads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_ads_tenant_isolation" ON "ads"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "keywords" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "keywords" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_keywords_tenant_isolation" ON "keywords"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "search_terms" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "search_terms" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_search_terms_tenant_isolation" ON "search_terms"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "daily_metrics" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "daily_metrics" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_daily_metrics_tenant_isolation" ON "daily_metrics"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "conversions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "conversions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_conversions_tenant_isolation" ON "conversions"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "budgets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_budgets_tenant_isolation" ON "budgets"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "recommendations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recommendations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_recommendations_tenant_isolation" ON "recommendations"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "automation_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "automation_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_automation_rules_tenant_isolation" ON "automation_rules"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "automation_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_automation_runs_tenant_isolation" ON "automation_runs"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "approvals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_approvals_tenant_isolation" ON "approvals"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "execution_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "execution_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_execution_jobs_tenant_isolation" ON "execution_jobs"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_audit_logs_tenant_isolation" ON "audit_logs"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_reports_tenant_isolation" ON "reports"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rls_notifications_tenant_isolation" ON "notifications"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint

-- 6. Immutability & Retention Trigger for audit_logs
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: Audit logs cannot be updated.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.retention_until IS NULL OR OLD.retention_until > NOW() THEN
      RAISE EXCEPTION 'AUDIT_LOG_RETENTION_LOCKED: Audit log cannot be deleted before retention_until.';
    END IF;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_protect_audit_logs
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
