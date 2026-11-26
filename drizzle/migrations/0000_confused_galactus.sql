CREATE TYPE "public"."ad_provider" AS ENUM('GOOGLE_ADS', 'META_ADS', 'MICROSOFT_ADS', 'MOCK_ADS');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('ENABLED', 'PAUSED', 'REMOVED', 'LIMITED_BY_BUDGET', 'LEARNING');--> statement-breakpoint
CREATE TYPE "public"."execution_job_status" AS ENUM('QUEUED', 'RUNNING', 'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED_BY_KILL_SWITCH');--> statement-breakpoint
CREATE TYPE "public"."execution_mode" AS ENUM('READ_ONLY', 'SUPERVISED', 'AUTONOMOUS_LOW_RISK');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('CONNECTED', 'EXPIRED', 'REVOKED', 'ERROR', 'SANDBOX_DEMO');--> statement-breakpoint
CREATE TYPE "public"."keyword_match_type" AS ENUM('EXACT', 'PHRASE', 'BROAD');--> statement-breakpoint
CREATE TYPE "public"."notification_severity" AS ENUM('INFO', 'WARNING', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('OWNER', 'ADMIN', 'TRAFFIC_MANAGER', 'ANALYST', 'CLIENT_VIEWER');--> statement-breakpoint
CREATE TABLE "ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"provider" "ad_provider" NOT NULL,
	"external_account_id" varchar(100) NOT NULL,
	"name" varchar(160) NOT NULL,
	"currency_code" varchar(3) DEFAULT 'BRL' NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/Sao_Paulo' NOT NULL,
	"is_demo_data" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"external_ad_group_id" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" "campaign_status" DEFAULT 'ENABLED' NOT NULL,
	"default_cpc_bid_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ad_group_id" uuid NOT NULL,
	"external_ad_id" varchar(100) NOT NULL,
	"ad_type" varchar(64) NOT NULL,
	"headlines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"descriptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"final_url" text NOT NULL,
	"policy_approval_status" varchar(64) DEFAULT 'APPROVED' NOT NULL,
	"status" "campaign_status" DEFAULT 'ENABLED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"reviewed_by_user_id" uuid,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"decision_notes" text,
	"expires_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_type" varchar(32) NOT NULL,
	"action" varchar(120) NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" varchar(120) NOT NULL,
	"previous_state" jsonb,
	"new_state" jsonb,
	"ip_address" varchar(64),
	"correlation_id" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"time_window_days" integer DEFAULT 7 NOT NULL,
	"min_impressions" integer DEFAULT 500 NOT NULL,
	"min_clicks" integer DEFAULT 30 NOT NULL,
	"min_spend_cents" integer DEFAULT 5000 NOT NULL,
	"cooldown_minutes" integer DEFAULT 360 NOT NULL,
	"max_financial_impact_pct" integer DEFAULT 15 NOT NULL,
	"conditions_json" jsonb NOT NULL,
	"action_json" jsonb NOT NULL,
	"requires_explicit_approval" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"campaign_id" uuid,
	"stage_reached" varchar(48) NOT NULL,
	"matched_conditions" boolean DEFAULT false NOT NULL,
	"simulation_output" jsonb,
	"blocked_reason" text,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid,
	"period_month" varchar(7) NOT NULL,
	"allocated_cents" bigint NOT NULL,
	"spent_cents" bigint DEFAULT 0 NOT NULL,
	"max_daily_hard_limit_cents" bigint NOT NULL,
	"alert_threshold_pct" integer DEFAULT 85 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"provider" "ad_provider" NOT NULL,
	"external_campaign_id" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" "campaign_status" DEFAULT 'ENABLED' NOT NULL,
	"channel_type" varchar(64) NOT NULL,
	"bidding_strategy" varchar(80) NOT NULL,
	"daily_budget_cents" bigint DEFAULT 0 NOT NULL,
	"is_demo_data" boolean DEFAULT false NOT NULL,
	"last_automated_change_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"industry" varchar(100) NOT NULL,
	"website_url" text,
	"monthly_budget_cap_cents" bigint DEFAULT 0 NOT NULL,
	"target_cpa_cents" integer,
	"target_roas" numeric(8, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"external_conversion_id" varchar(100) NOT NULL,
	"name" varchar(160) NOT NULL,
	"category" varchar(64) NOT NULL,
	"attribution_model" varchar(64) NOT NULL,
	"lookback_window_days" integer DEFAULT 30 NOT NULL,
	"is_primary_goal" boolean DEFAULT true NOT NULL,
	"tracking_status" varchar(64) DEFAULT 'ACTIVE' NOT NULL,
	"last_received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"metric_date" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"cost_cents" bigint DEFAULT 0 NOT NULL,
	"conversions" numeric(10, 2) DEFAULT '0' NOT NULL,
	"conversion_value_cents" bigint DEFAULT 0 NOT NULL,
	"ctr_pct" numeric(6, 2) DEFAULT '0' NOT NULL,
	"cpc_cents" integer DEFAULT 0 NOT NULL,
	"cpa_cents" integer DEFAULT 0 NOT NULL,
	"roas" numeric(8, 2) DEFAULT '0' NOT NULL,
	"is_demo_data" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"status" "execution_job_status" DEFAULT 'QUEUED' NOT NULL,
	"action_type" varchar(80) NOT NULL,
	"request_payload" jsonb NOT NULL,
	"response_payload" jsonb,
	"verification_passed" boolean,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "ad_provider" NOT NULL,
	"external_account_label" varchar(160) NOT NULL,
	"status" "integration_status" DEFAULT 'SANDBOX_DEMO' NOT NULL,
	"encrypted_access_token" text,
	"encrypted_refresh_token" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_expires_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"is_demo_integration" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ad_group_id" uuid NOT NULL,
	"external_keyword_id" varchar(100) NOT NULL,
	"text" varchar(255) NOT NULL,
	"match_type" "keyword_match_type" NOT NULL,
	"is_negative" boolean DEFAULT false NOT NULL,
	"quality_score" integer,
	"cpc_bid_cents" integer,
	"status" "campaign_status" DEFAULT 'ENABLED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" DEFAULT 'ANALYST' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_user_id" uuid,
	"severity" "notification_severity" DEFAULT 'INFO' NOT NULL,
	"title" varchar(200) NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"execution_mode" "execution_mode" DEFAULT 'READ_ONLY' NOT NULL,
	"emergency_stop_active" boolean DEFAULT false NOT NULL,
	"emergency_stop_reason" text,
	"max_daily_budget_change_pct" integer DEFAULT 20 NOT NULL,
	"min_cooldown_minutes" integer DEFAULT 360 NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/Sao_Paulo' NOT NULL,
	"currency_code" varchar(3) DEFAULT 'BRL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid,
	"analyzer_service" varchar(80) NOT NULL,
	"title" varchar(200) NOT NULL,
	"diagnosis" text NOT NULL,
	"justification" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"proposed_action_type" varchar(80) NOT NULL,
	"proposed_payload" jsonb NOT NULL,
	"risk_level" "risk_level" DEFAULT 'MEDIUM' NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"is_demo_data" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"executive_summary" text NOT NULL,
	"metrics_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ad_group_id" uuid,
	"search_term" varchar(255) NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"cost_cents" bigint DEFAULT 0 NOT NULL,
	"conversions" numeric(10, 2) DEFAULT '0' NOT NULL,
	"observed_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"avatar_url" text,
	"email_verified_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"lgpd_consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_groups" ADD CONSTRAINT "ad_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_groups" ADD CONSTRAINT "ad_groups_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_ad_group_id_ad_groups_id_fk" FOREIGN KEY ("ad_group_id") REFERENCES "public"."ad_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_ad_group_id_ad_groups_id_fk" FOREIGN KEY ("ad_group_id") REFERENCES "public"."ad_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_ad_group_id_ad_groups_id_fk" FOREIGN KEY ("ad_group_id") REFERENCES "public"."ad_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_accounts_org_ext_idx" ON "ad_accounts" USING btree ("organization_id","provider","external_account_id");--> statement-breakpoint
CREATE INDEX "ad_accounts_client_idx" ON "ad_accounts" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE INDEX "ad_groups_org_campaign_idx" ON "ad_groups" USING btree ("organization_id","campaign_id");--> statement-breakpoint
CREATE INDEX "ads_org_adgroup_idx" ON "ads" USING btree ("organization_id","ad_group_id");--> statement-breakpoint
CREATE INDEX "approvals_org_status_idx" ON "approvals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_rules_org_enabled_idx" ON "automation_rules" USING btree ("organization_id","is_enabled");--> statement-breakpoint
CREATE INDEX "automation_runs_org_rule_idx" ON "automation_runs" USING btree ("organization_id","rule_id");--> statement-breakpoint
CREATE INDEX "budgets_org_client_period_idx" ON "budgets" USING btree ("organization_id","client_id","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_org_ext_idx" ON "campaigns" USING btree ("organization_id","provider","external_campaign_id");--> statement-breakpoint
CREATE INDEX "campaigns_org_status_idx" ON "campaigns" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "clients_org_idx" ON "clients" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversions_org_account_idx" ON "conversions" USING btree ("organization_id","ad_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_metrics_org_camp_date_idx" ON "daily_metrics" USING btree ("organization_id","campaign_id","metric_date");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_jobs_idempotency_idx" ON "execution_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "execution_jobs_org_status_idx" ON "execution_jobs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "integrations_org_provider_idx" ON "integrations" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "keywords_org_adgroup_idx" ON "keywords" USING btree ("organization_id","ad_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_idx" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_org_idx" ON "memberships" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notifications_org_read_idx" ON "notifications" USING btree ("organization_id","is_read");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "recommendations_org_status_idx" ON "recommendations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "reports_org_client_idx" ON "reports" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE INDEX "search_terms_org_campaign_idx" ON "search_terms" USING btree ("organization_id","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");