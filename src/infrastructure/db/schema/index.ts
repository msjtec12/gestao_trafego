import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  bigint,
  numeric,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================================================
// ENUMS
// ============================================================================

export const userRoleEnum = pgEnum("user_role", [
  "OWNER",
  "ADMIN",
  "TRAFFIC_MANAGER",
  "ANALYST",
  "CLIENT_VIEWER",
]);

export const executionModeEnum = pgEnum("execution_mode", [
  "READ_ONLY",
  "SUPERVISED",
  "AUTONOMOUS_LOW_RISK",
]);

export const adProviderEnum = pgEnum("ad_provider", [
  "GOOGLE_ADS",
  "META_ADS",
  "MICROSOFT_ADS",
  "MOCK_ADS",
]);

export const integrationStatusEnum = pgEnum("integration_status", [
  "CONNECTED",
  "EXPIRED",
  "REVOKED",
  "ERROR",
  "SANDBOX_DEMO",
]);

export const campaignStatusEnum = pgEnum("campaign_status", [
  "ENABLED",
  "PAUSED",
  "REMOVED",
  "LIMITED_BY_BUDGET",
  "LEARNING",
]);

export const keywordMatchTypeEnum = pgEnum("keyword_match_type", [
  "EXACT",
  "PHRASE",
  "BROAD",
]);

export const riskLevelEnum = pgEnum("risk_level", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "EXECUTED",
]);

export const executionJobStatusEnum = pgEnum("execution_job_status", [
  "QUEUED",
  "RUNNING",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "CANCELLED_BY_KILL_SWITCH",
]);

export const notificationSeverityEnum = pgEnum("notification_severity", [
  "INFO",
  "WARNING",
  "CRITICAL",
]);

// ============================================================================
// 1. ORGANIZATIONS (Multi-Tenant Root)
// ============================================================================

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    executionMode: executionModeEnum("execution_mode")
      .default("READ_ONLY")
      .notNull(),
    emergencyStopActive: boolean("emergency_stop_active")
      .default(false)
      .notNull(),
    emergencyStopReason: text("emergency_stop_reason"),
    maxDailyBudgetChangePct: integer("max_daily_budget_change_pct")
      .default(20)
      .notNull(),
    minCooldownMinutes: integer("min_cooldown_minutes").default(360).notNull(),
    timezone: varchar("timezone", { length: 64 })
      .default("America/Sao_Paulo")
      .notNull(),
    currencyCode: varchar("currency_code", { length: 3 })
      .default("BRL")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("organizations_slug_idx").on(table.slug)]
);

// ============================================================================
// 2. USERS
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    avatarUrl: text("avatar_url"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    isActive: boolean("is_active").default(true).notNull(),
    lgpdConsentAt: timestamp("lgpd_consent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)]
);

// ============================================================================
// 3. MEMBERSHIPS (RBAC Multi-Tenant)
// ============================================================================

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").default("ANALYST").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("memberships_org_user_idx").on(
      table.organizationId,
      table.userId
    ),
    index("memberships_org_idx").on(table.organizationId),
  ]
);

// ============================================================================
// 4. CLIENTS
// ============================================================================

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    industry: varchar("industry", { length: 100 }).notNull(),
    websiteUrl: text("website_url"),
    monthlyBudgetCapCents: bigint("monthly_budget_cap_cents", {
      mode: "number",
    })
      .default(0)
      .notNull(),
    targetCpaCents: integer("target_cpa_cents"),
    targetRoas: numeric("target_roas", { precision: 8, scale: 2 }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("clients_org_idx").on(table.organizationId)]
);

// ============================================================================
// 5. INTEGRATIONS (Encrypted OAuth Credentials)
// ============================================================================

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: adProviderEnum("provider").notNull(),
    externalAccountLabel: varchar("external_account_label", {
      length: 160,
    }).notNull(),
    status: integrationStatusEnum("status").default("SANDBOX_DEMO").notNull(),
    encryptedAccessToken: text("encrypted_access_token"),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    isDemoIntegration: boolean("is_demo_integration").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("integrations_org_provider_idx").on(
      table.organizationId,
      table.provider
    ),
  ]
);

// ============================================================================
// 6. AD ACCOUNTS
// ============================================================================

export const adAccounts = pgTable(
  "ad_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    provider: adProviderEnum("provider").notNull(),
    externalAccountId: varchar("external_account_id", {
      length: 100,
    }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 })
      .default("BRL")
      .notNull(),
    timezone: varchar("timezone", { length: 64 })
      .default("America/Sao_Paulo")
      .notNull(),
    isDemoData: boolean("is_demo_data").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("ad_accounts_org_ext_idx").on(
      table.organizationId,
      table.provider,
      table.externalAccountId
    ),
    index("ad_accounts_client_idx").on(table.organizationId, table.clientId),
  ]
);

// ============================================================================
// 7. CAMPAIGNS
// ============================================================================

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    provider: adProviderEnum("provider").notNull(),
    externalCampaignId: varchar("external_campaign_id", {
      length: 100,
    }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    status: campaignStatusEnum("status").default("ENABLED").notNull(),
    channelType: varchar("channel_type", { length: 64 }).notNull(),
    biddingStrategy: varchar("bidding_strategy", { length: 80 }).notNull(),
    dailyBudgetCents: bigint("daily_budget_cents", { mode: "number" })
      .default(0)
      .notNull(),
    isDemoData: boolean("is_demo_data").default(false).notNull(),
    lastAutomatedChangeAt: timestamp("last_automated_change_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("campaigns_org_ext_idx").on(
      table.organizationId,
      table.provider,
      table.externalCampaignId
    ),
    index("campaigns_org_status_idx").on(table.organizationId, table.status),
  ]
);

// ============================================================================
// 8. AD GROUPS
// ============================================================================

export const adGroups = pgTable(
  "ad_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    externalAdGroupId: varchar("external_ad_group_id", {
      length: 100,
    }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    status: campaignStatusEnum("status").default("ENABLED").notNull(),
    defaultCpcBidCents: integer("default_cpc_bid_cents"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ad_groups_org_campaign_idx").on(
      table.organizationId,
      table.campaignId
    ),
  ]
);

// ============================================================================
// 9. ADS
// ============================================================================

export const ads = pgTable(
  "ads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    adGroupId: uuid("ad_group_id")
      .notNull()
      .references(() => adGroups.id, { onDelete: "cascade" }),
    externalAdId: varchar("external_ad_id", { length: 100 }).notNull(),
    adType: varchar("ad_type", { length: 64 }).notNull(),
    headlines: jsonb("headlines").$type<string[]>().default([]).notNull(),
    descriptions: jsonb("descriptions").$type<string[]>().default([]).notNull(),
    finalUrl: text("final_url").notNull(),
    policyApprovalStatus: varchar("policy_approval_status", { length: 64 })
      .default("APPROVED")
      .notNull(),
    status: campaignStatusEnum("status").default("ENABLED").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("ads_org_adgroup_idx").on(table.organizationId, table.adGroupId)]
);

// ============================================================================
// 10. KEYWORDS
// ============================================================================

export const keywords = pgTable(
  "keywords",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    adGroupId: uuid("ad_group_id")
      .notNull()
      .references(() => adGroups.id, { onDelete: "cascade" }),
    externalKeywordId: varchar("external_keyword_id", {
      length: 100,
    }).notNull(),
    text: varchar("text", { length: 255 }).notNull(),
    matchType: keywordMatchTypeEnum("match_type").notNull(),
    isNegative: boolean("is_negative").default(false).notNull(),
    qualityScore: integer("quality_score"),
    cpcBidCents: integer("cpc_bid_cents"),
    status: campaignStatusEnum("status").default("ENABLED").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("keywords_org_adgroup_idx").on(table.organizationId, table.adGroupId),
  ]
);

// ============================================================================
// 11. SEARCH TERMS
// ============================================================================

export const searchTerms = pgTable(
  "search_terms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    adGroupId: uuid("ad_group_id").references(() => adGroups.id, {
      onDelete: "set null",
    }),
    searchTerm: varchar("search_term", { length: 255 }).notNull(),
    impressions: integer("impressions").default(0).notNull(),
    clicks: integer("clicks").default(0).notNull(),
    costCents: bigint("cost_cents", { mode: "number" }).default(0).notNull(),
    conversions: numeric("conversions", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    observedDate: date("observed_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("search_terms_org_campaign_idx").on(
      table.organizationId,
      table.campaignId
    ),
  ]
);

// ============================================================================
// 12. DAILY METRICS
// ============================================================================

export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    metricDate: date("metric_date").notNull(),
    impressions: integer("impressions").default(0).notNull(),
    clicks: integer("clicks").default(0).notNull(),
    costCents: bigint("cost_cents", { mode: "number" }).default(0).notNull(),
    conversions: numeric("conversions", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    conversionValueCents: bigint("conversion_value_cents", { mode: "number" })
      .default(0)
      .notNull(),
    ctrPct: numeric("ctr_pct", { precision: 6, scale: 2 })
      .default("0")
      .notNull(),
    cpcCents: integer("cpc_cents").default(0).notNull(),
    cpaCents: integer("cpa_cents").default(0).notNull(),
    roas: numeric("roas", { precision: 8, scale: 2 }).default("0").notNull(),
    isDemoData: boolean("is_demo_data").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("daily_metrics_org_camp_date_idx").on(
      table.organizationId,
      table.campaignId,
      table.metricDate
    ),
  ]
);

// ============================================================================
// 13. CONVERSIONS
// ============================================================================

export const conversions = pgTable(
  "conversions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    externalConversionId: varchar("external_conversion_id", {
      length: 100,
    }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    category: varchar("category", { length: 64 }).notNull(),
    attributionModel: varchar("attribution_model", { length: 64 }).notNull(),
    lookbackWindowDays: integer("lookback_window_days").default(30).notNull(),
    isPrimaryGoal: boolean("is_primary_goal").default(true).notNull(),
    trackingStatus: varchar("tracking_status", { length: 64 })
      .default("ACTIVE")
      .notNull(),
    lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("conversions_org_account_idx").on(
      table.organizationId,
      table.adAccountId
    ),
  ]
);

// ============================================================================
// 14. BUDGETS
// ============================================================================

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    periodMonth: varchar("period_month", { length: 7 }).notNull(), // YYYY-MM
    allocatedCents: bigint("allocated_cents", { mode: "number" }).notNull(),
    spentCents: bigint("spent_cents", { mode: "number" }).default(0).notNull(),
    maxDailyHardLimitCents: bigint("max_daily_hard_limit_cents", {
      mode: "number",
    }).notNull(),
    alertThresholdPct: integer("alert_threshold_pct").default(85).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("budgets_org_client_period_idx").on(
      table.organizationId,
      table.clientId,
      table.periodMonth
    ),
  ]
);

// ============================================================================
// 15. RECOMMENDATIONS (AI & Rule Insights)
// ============================================================================

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "cascade",
    }),
    analyzerService: varchar("analyzer_service", { length: 80 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    diagnosis: text("diagnosis").notNull(),
    justification: text("justification").notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, string | number>>()
      .notNull(),
    proposedActionType: varchar("proposed_action_type", {
      length: 80,
    }).notNull(),
    proposedPayload: jsonb("proposed_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    riskLevel: riskLevelEnum("risk_level").default("MEDIUM").notNull(),
    requiresApproval: boolean("requires_approval").default(true).notNull(),
    status: approvalStatusEnum("status").default("PENDING").notNull(),
    isDemoData: boolean("is_demo_data").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("recommendations_org_status_idx").on(
      table.organizationId,
      table.status
    ),
  ]
);

// ============================================================================
// 16. AUTOMATION RULES
// ============================================================================

export const automationRules = pgTable(
  "automation_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull(),
    isEnabled: boolean("is_enabled").default(false).notNull(),
    timeWindowDays: integer("time_window_days").default(7).notNull(),
    minImpressions: integer("min_impressions").default(500).notNull(),
    minClicks: integer("min_clicks").default(30).notNull(),
    minSpendCents: integer("min_spend_cents").default(5000).notNull(),
    cooldownMinutes: integer("cooldown_minutes").default(360).notNull(),
    maxFinancialImpactPct: integer("max_financial_impact_pct")
      .default(15)
      .notNull(),
    conditionsJson: jsonb("conditions_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    actionJson: jsonb("action_json").$type<Record<string, unknown>>().notNull(),
    requiresExplicitApproval: boolean("requires_explicit_approval")
      .default(true)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("automation_rules_org_enabled_idx").on(
      table.organizationId,
      table.isEnabled
    ),
  ]
);

// ============================================================================
// 17. AUTOMATION RUNS
// ============================================================================

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    stageReached: varchar("stage_reached", { length: 48 }).notNull(),
    matchedConditions: boolean("matched_conditions").default(false).notNull(),
    simulationOutput: jsonb("simulation_output").$type<Record<string, unknown>>(),
    blockedReason: text("blocked_reason"),
    executedAt: timestamp("executed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("automation_runs_org_rule_idx").on(table.organizationId, table.ruleId),
  ]
);

// ============================================================================
// 18. APPROVALS
// ============================================================================

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: approvalStatusEnum("status").default("PENDING").notNull(),
    decisionNotes: text("decision_notes"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("approvals_org_status_idx").on(table.organizationId, table.status),
  ]
);

// ============================================================================
// 19. EXECUTION JOBS (Idempotent Queue)
// ============================================================================

export const executionJobs = pgTable(
  "execution_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => approvals.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    status: executionJobStatusEnum("status").default("QUEUED").notNull(),
    actionType: varchar("action_type", { length: 80 }).notNull(),
    requestPayload: jsonb("request_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    responsePayload: jsonb("response_payload").$type<Record<string, unknown>>(),
    verificationPassed: boolean("verification_passed"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    errorMessage: text("error_message"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("execution_jobs_idempotency_idx").on(table.idempotencyKey),
    index("execution_jobs_org_status_idx").on(
      table.organizationId,
      table.status
    ),
  ]
);

// ============================================================================
// 20. AUDIT LOGS (Immutable Security & Operation Trail)
// ============================================================================

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorType: varchar("actor_type", { length: 32 }).notNull(), // USER | SYSTEM | AUTOMATION | AI_ADVISOR
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 120 }).notNull(),
    previousState: jsonb("previous_state").$type<Record<string, unknown>>(),
    newState: jsonb("new_state").$type<Record<string, unknown>>(),
    ipAddress: varchar("ip_address", { length: 64 }),
    correlationId: varchar("correlation_id", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_logs_org_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
  ]
);

// ============================================================================
// 21. REPORTS
// ============================================================================

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    executiveSummary: text("executive_summary").notNull(),
    metricsSnapshot: jsonb("metrics_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("reports_org_client_idx").on(table.organizationId, table.clientId),
  ]
);

// ============================================================================
// 22. NOTIFICATIONS
// ============================================================================

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    severity: notificationSeverityEnum("severity").default("INFO").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    message: text("message").notNull(),
    isRead: boolean("is_read").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("notifications_org_read_idx").on(table.organizationId, table.isRead),
  ]
);

export const ALL_DOMAIN_TABLES = [
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
  "search_terms",
  "daily_metrics",
  "conversions",
  "budgets",
  "recommendations",
  "automation_rules",
  "automation_runs",
  "approvals",
  "execution_jobs",
  "audit_logs",
  "reports",
  "notifications",
] as const;
