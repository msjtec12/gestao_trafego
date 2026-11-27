import { and, eq, inArray } from "drizzle-orm";
import type { AdProviderType, UserRole } from "@/domain/types";
import { withTenantTransaction } from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";
import {
  PersistentDrizzleTenantRepository,
  type AggregatedPeriodMetricsResult,
} from "@/infrastructure/db/repositories/drizzle-tenant-repositories";
import {
  PersistentAIRecommendationsAndReportsRepository,
  type PersistedExecutiveReport,
  type PersistedRecommendationWithApproval,
} from "@/infrastructure/db/repositories/ai-recommendations-reports-repository";
import { resolveUnifiedAuthJsPostgresSession } from "@/security/auth";
import {
  getGoogleAdsOAuthConfigurationStatus,
  type GoogleAdsOAuthConfigStatus,
} from "@/security/env";
import {
  GoogleAdsProvider,
  MockAdsProvider,
} from "@/integrations/providers/ads-providers";
import type {
  NormalizedCampaign,
  NormalizedDailyMetric,
} from "@/integrations/contracts/advertising-provider";
import {
  getDemoAIRecommendations,
  type AIRecommendation,
} from "@/modules/ai/schemas/recommendation-schemas";
import { DEMO_ORGANIZATION } from "@/modules/organizations";
import { ALL_DOMAIN_TABLES } from "@/infrastructure/db/schema";

export interface OrganizationOption {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly executionMode: "READ_ONLY";
  readonly timezone: string;
  readonly currencyCode: string;
  readonly maxDailyBudgetChangePct: number;
  readonly minCooldownMinutes: number;
  readonly emergencyStopActive?: boolean;
  readonly isDemo: boolean;
}

export interface ClientRecordViewModel {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly industry: string;
  readonly monthlyBudgetCapBrl: number;
  readonly targetCpaBrl: number | null;
  readonly targetRoas: number | null;
  readonly isActive: boolean;
  readonly isDemoData: boolean;
}

export interface AdAccountRecordViewModel {
  readonly id: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly provider: AdProviderType;
  readonly externalAccountId: string;
  readonly managerCustomerId: string | null;
  readonly isMccAccount: boolean;
  readonly isSelectedForSync: boolean;
  readonly name: string;
  readonly currencyCode: string;
  readonly timezone: string;
  readonly isDemoData: boolean;
}

export interface MemberRecordViewModel {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: UserRole;
  readonly allowedClientIds: readonly string[];
}

export interface IntegrationHealthViewModel {
  readonly id: string;
  readonly organizationId: string;
  readonly provider: AdProviderType;
  readonly label: string;
  readonly status:
    | "CONNECTED"
    | "EXPIRED"
    | "REVOKED"
    | "ERROR"
    | "SANDBOX_DEMO"
    | "BLOCKED_MISSING_CREDENTIALS";
  readonly mode: "READ_ONLY";
  readonly managerCustomerId: string | null;
  readonly lastSyncedAtIso: string | null;
  readonly lastCheckpoint: string | null;
  readonly latencyMs: number;
  readonly message: string;
  readonly isDemoData: boolean;
}

export interface SyncRunViewModel {
  readonly id: string;
  readonly integrationId: string;
  readonly provider: AdProviderType;
  readonly status: string;
  readonly checkpointToken: string | null;
  readonly entitiesSynced: Record<string, number>;
  readonly startedAtIso: string;
  readonly completedAtIso: string | null;
  readonly errorCode: string | null;
}

export interface AuditEventViewModel {
  readonly id: string;
  readonly timestamp: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly detail: string;
}

export interface DashboardOverviewViewModel {
  readonly organizationName: string;
  readonly organizationId: string;
  readonly authenticatedUserEmail?: string;
  readonly authenticatedUserName?: string;
  readonly authenticatedUserRole?: UserRole;
  readonly defaultExecutionMode: "READ_ONLY";
  readonly isDemoEnvironment: boolean;
  readonly isServerKillSwitchPersisted: boolean;
  readonly emergencyStopActive: boolean;
  readonly organizations: readonly OrganizationOption[];
  readonly clients: readonly ClientRecordViewModel[];
  readonly adAccounts: readonly AdAccountRecordViewModel[];
  readonly members: readonly MemberRecordViewModel[];
  readonly integrations: readonly IntegrationHealthViewModel[];
  readonly googleAdsConfigStatus?: GoogleAdsOAuthConfigStatus;
  readonly campaigns: NormalizedCampaign[];
  readonly dailyMetrics: NormalizedDailyMetric[];
  readonly aggregatedMetrics?: AggregatedPeriodMetricsResult;
  readonly syncHistory?: readonly SyncRunViewModel[];
  readonly auditTrail?: readonly AuditEventViewModel[];
  readonly recommendations: AIRecommendation[];
  readonly persistedRecommendations?: readonly PersistedRecommendationWithApproval[];
  readonly executiveReports?: readonly PersistedExecutiveReport[];
  readonly domainTables: readonly string[];
}

/**
 * Loads the authenticated operational dashboard state strictly from PostgreSQL
 * inside an RLS-enforced tenant transaction (`withTenantTransaction`).
 * NEVER falls back to MockAdsProvider or fake demo metrics when no accounts are connected.
 */
export async function getAuthenticatedOperationalDashboardUseCase(params: {
  readonly sessionToken: string;
  readonly clientId?: string;
  readonly adAccountId?: string;
  readonly periodDays?: number;
}): Promise<DashboardOverviewViewModel> {
  const session = await resolveUnifiedAuthJsPostgresSession({
    rawCookieOrToken: params.sessionToken,
  });

  return await withTenantTransaction(session.context, async (tx) => {
    const repo = new PersistentDrizzleTenantRepository(tx);
    const activeOrgRow = await repo.getOrganization(session.context);
    const clientRows = await repo.listClients(session.context);
    const accountRows = await repo.listAdAccounts(session.context, {
      clientId: params.clientId,
    });
    const integrationRows = await repo.listPublicIntegrations(session.context);
    const campaignRows = await repo.listCampaigns(session.context, {
      clientId: params.clientId,
      adAccountId: params.adAccountId,
    });
    const syncRunRows = await repo.listSyncRuns(session.context);
    const auditRows = await repo.listAuditLogs(session.context, 25);

    const aiRepo = new PersistentAIRecommendationsAndReportsRepository(tx);
    const persistedRecommendations = await aiRepo.listRecommendations(
      session.context,
      { clientId: params.clientId }
    );
    const executiveReports = await aiRepo.listExecutiveReports(
      session.context,
      { clientId: params.clientId }
    );

    const aggregated = await repo.getAggregatedDashboardMetrics(
      session.context,
      {
        clientId: params.clientId,
        adAccountId: params.adAccountId,
        periodDays: params.periodDays ?? 7,
      }
    );

    // Load organization memberships + user details
    const orgMemberships: (typeof schema.memberships.$inferSelect)[] = await tx
      .select()
      .from(schema.memberships)
      .where(
        eq(schema.memberships.organizationId, session.context.organizationId)
      );

    const memberUserIds = orgMemberships.map((m) => m.userId);
    const userRows: (typeof schema.users.$inferSelect)[] =
      memberUserIds.length > 0
        ? await tx
            .select()
            .from(schema.users)
            .where(inArray(schema.users.id, memberUserIds))
        : [];

    const clientAccessRows: (typeof schema.memberClientAccess.$inferSelect)[] =
      await tx
        .select()
        .from(schema.memberClientAccess)
        .where(
          eq(
            schema.memberClientAccess.organizationId,
            session.context.organizationId
          )
        );

    const clientMap = new Map(clientRows.map((c) => [c.id, c]));
    const accountMap = new Map(accountRows.map((a) => [a.id, a]));

    // Map persisted campaigns with their persisted daily_metrics (explicit organization_id filter + RLS)
    const campaignIds = campaignRows.map((c) => c.id);
    const persistedDailyMetrics: (typeof schema.dailyMetrics.$inferSelect)[] =
      campaignIds.length > 0
        ? await tx
            .select()
            .from(schema.dailyMetrics)
            .where(
              and(
                eq(
                  schema.dailyMetrics.organizationId,
                  session.context.organizationId
                ),
                inArray(schema.dailyMetrics.campaignId, campaignIds)
              )
            )
        : [];

    const normalizedCampaigns: NormalizedCampaign[] = campaignRows.map((c) => {
      const acc = accountMap.get(c.adAccountId);
      const cli = acc ? clientMap.get(acc.clientId) : undefined;
      const campMetrics = persistedDailyMetrics.filter(
        (m) => m.campaignId === c.id
      );

      const spendCents = campMetrics.reduce(
        (sum, m) => sum + Number(m.costCents),
        0
      );
      const conversions = campMetrics.reduce(
        (sum, m) => sum + Number(m.conversions),
        0
      );
      const convValueCents = campMetrics.reduce(
        (sum, m) => sum + Number(m.conversionValueCents),
        0
      );
      const impressions = campMetrics.reduce(
        (sum, m) => sum + Number(m.impressions),
        0
      );
      const clicks = campMetrics.reduce((sum, m) => sum + Number(m.clicks), 0);

      const spendBrl = Number((spendCents / 100).toFixed(2));
      const cpaBrl =
        conversions > 0 ? Number((spendBrl / conversions).toFixed(2)) : 0;
      const roas =
        spendCents > 0 ? Number((convValueCents / spendCents).toFixed(2)) : 0;
      const ctrPct =
        impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0;

      return {
        id: c.id,
        organizationId: c.organizationId,
        clientId: acc?.clientId,
        externalCampaignId: c.externalCampaignId,
        clientName: cli?.name ?? "Cliente Associado",
        name: c.name,
        provider: c.provider,
        channelType:
          (c.channelType as NormalizedCampaign["channelType"]) ?? "SEARCH",
        status: c.status,
        biddingStrategy: c.biddingStrategy,
        dailyBudgetBrl: Number((Number(c.dailyBudgetCents) / 100).toFixed(2)),
        spend7dBrl: spendBrl,
        conversions7d: conversions,
        cpa7dBrl: cpaBrl,
        roas7d: roas,
        ctr7dPct: ctrPct,
        impressions7d: impressions,
        clicks7d: clicks,
        isDemoData: c.isDemoData,
        lastAutomatedChangeAt: c.lastAutomatedChangeAt
          ? c.lastAutomatedChangeAt.toISOString()
          : null,
      };
    });

    const hasLiveGoogleCredentials = Boolean(
      process.env.GOOGLE_ADS_CLIENT_ID &&
        !process.env.GOOGLE_ADS_CLIENT_ID.startsWith("replace_with_")
    );

    const integrationsVm: IntegrationHealthViewModel[] = integrationRows.map(
      (intg) => ({
        id: intg.id,
        organizationId: intg.organizationId,
        provider: intg.provider,
        label: intg.externalAccountLabel,
        status:
          intg.status === "REVOKED"
            ? "REVOKED"
            : intg.status === "CONNECTED"
              ? "CONNECTED"
              : intg.isDemoIntegration
                ? "SANDBOX_DEMO"
                : hasLiveGoogleCredentials
                  ? intg.status
                  : "BLOCKED_MISSING_CREDENTIALS",
        mode: "READ_ONLY",
        managerCustomerId: intg.managerCustomerId,
        lastSyncedAtIso: intg.lastSyncedAt
          ? intg.lastSyncedAt.toISOString()
          : null,
        lastCheckpoint: intg.lastCheckpointToken ?? null,
        latencyMs: 0,
        message:
          intg.status === "REVOKED"
            ? "Credenciais revogadas e removidas do Credential Vault."
            : intg.status === "CONNECTED"
              ? "Integração OAuth 2.0 ativa no PostgreSQL Credential Vault (AES-256-GCM + AAD)."
              : "Bloqueado de forma transparente: GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET não configurados com credenciais oficiais. Nenhuma conexão falsa é simulada.",
        isDemoData: intg.isDemoIntegration,
      })
    );

    const organizationsVm: OrganizationOption[] =
      session.availableOrganizations.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        executionMode: "READ_ONLY",
        timezone: activeOrgRow.timezone,
        currencyCode: activeOrgRow.currencyCode,
        maxDailyBudgetChangePct: activeOrgRow.maxDailyBudgetChangePct,
        minCooldownMinutes: activeOrgRow.minCooldownMinutes,
        emergencyStopActive: activeOrgRow.emergencyStopActive,
        isDemo: false,
      }));

    const clientsVm: ClientRecordViewModel[] = clientRows.map((c) => ({
      id: c.id,
      organizationId: c.organizationId,
      name: c.name,
      industry: c.industry,
      monthlyBudgetCapBrl: Number(
        (Number(c.monthlyBudgetCapCents) / 100).toFixed(2)
      ),
      targetCpaBrl: c.targetCpaCents
        ? Number((c.targetCpaCents / 100).toFixed(2))
        : null,
      targetRoas: c.targetRoas ? Number(c.targetRoas) : null,
      isActive: c.isActive,
      isDemoData: false,
    }));

    const adAccountsVm: AdAccountRecordViewModel[] = accountRows.map((a) => ({
      id: a.id,
      organizationId: a.organizationId,
      clientId: a.clientId,
      clientName: clientMap.get(a.clientId)?.name ?? "Cliente",
      provider: a.provider,
      externalAccountId: a.externalAccountId,
      managerCustomerId: a.managerCustomerId,
      isMccAccount: a.isMccAccount,
      isSelectedForSync: a.isSelectedForSync,
      name: a.name,
      currencyCode: a.currencyCode,
      timezone: a.timezone,
      isDemoData: a.isDemoData,
    }));

    const membersVm: MemberRecordViewModel[] = orgMemberships.map((m) => {
      const u = userRows.find((usr) => usr.id === m.userId);
      const assignedClients = clientAccessRows
        .filter((ca) => ca.membershipId === m.id)
        .map((ca) => ca.clientId);
      return {
        id: m.id,
        organizationId: m.organizationId,
        userId: m.userId,
        fullName: u?.fullName ?? "Usuário",
        email: u?.email ?? "",
        role: m.role,
        allowedClientIds:
          m.role === "CLIENT_VIEWER"
            ? assignedClients
            : clientsVm.map((c) => c.id),
      };
    });

    const syncHistoryVm: SyncRunViewModel[] = syncRunRows.map((sr) => ({
      id: sr.id,
      integrationId: sr.integrationId,
      provider: sr.provider,
      status: sr.status,
      checkpointToken: sr.checkpointToken,
      entitiesSynced: sr.entitiesSynced,
      startedAtIso: sr.startedAt.toISOString(),
      completedAtIso: sr.completedAt ? sr.completedAt.toISOString() : null,
      errorCode: sr.errorCode,
    }));

    const auditTrailVm: AuditEventViewModel[] = auditRows.map((ar) => ({
      id: ar.id,
      timestamp: ar.createdAt.toISOString().slice(0, 19).replace("T", " "),
      action: ar.action,
      entityType: ar.entityType,
      entityId: ar.entityId,
      detail: JSON.stringify(ar.newState ?? {}),
    }));

    return {
      organizationName: activeOrgRow.name,
      organizationId: activeOrgRow.id,
      authenticatedUserEmail: session.user.email,
      authenticatedUserName: session.user.fullName,
      authenticatedUserRole: session.context.role,
      defaultExecutionMode: "READ_ONLY",
      isDemoEnvironment: false,
      isServerKillSwitchPersisted: true,
      emergencyStopActive: activeOrgRow.emergencyStopActive,
      organizations: organizationsVm,
      clients: clientsVm,
      adAccounts: adAccountsVm,
      members: membersVm,
      integrations: integrationsVm,
      googleAdsConfigStatus: getGoogleAdsOAuthConfigurationStatus(),
      campaigns: normalizedCampaigns,
      dailyMetrics: [...aggregated.timeline],
      aggregatedMetrics: aggregated,
      syncHistory: syncHistoryVm,
      auditTrail: auditTrailVm,
      recommendations: [],
      persistedRecommendations,
      executiveReports,
      domainTables: ALL_DOMAIN_TABLES,
    };
  });
}

/**
 * Isolated public demo view model used exclusively by `/demo`.
 */
export async function getDashboardOverviewUseCase(): Promise<DashboardOverviewViewModel> {
  const mockProvider = new MockAdsProvider();
  const googleProvider = new GoogleAdsProvider();

  const [campaigns, dailyMetrics, mockHealth, googleHealth] = await Promise.all([
    mockProvider.listCampaigns(DEMO_ORGANIZATION.id),
    mockProvider.getDailyMetrics(),
    mockProvider.checkHealth(),
    googleProvider.checkHealth(),
  ]);
  const recommendations = getDemoAIRecommendations(DEMO_ORGANIZATION.id);

  const organizations: readonly OrganizationOption[] = [
    {
      id: DEMO_ORGANIZATION.id,
      name: DEMO_ORGANIZATION.name,
      slug: DEMO_ORGANIZATION.slug,
      executionMode: "READ_ONLY",
      timezone: "America/Sao_Paulo",
      currencyCode: "BRL",
      maxDailyBudgetChangePct: 20,
      minCooldownMinutes: 360,
      isDemo: true,
    },
    {
      id: "org-prod-konnexy-local",
      name: "Konnexy Agência & Negócios Locais (Operacional)",
      slug: "konnexy-operacional",
      executionMode: "READ_ONLY",
      timezone: "America/Sao_Paulo",
      currencyCode: "BRL",
      maxDailyBudgetChangePct: 15,
      minCooldownMinutes: 360,
      isDemo: false,
    },
  ];

  const clients: readonly ClientRecordViewModel[] = [
    {
      id: "client-sorriso-prime",
      organizationId: DEMO_ORGANIZATION.id,
      name: "Clínica Odontológica Sorriso Prime (SP)",
      industry: "Saúde & Odontologia",
      monthlyBudgetCapBrl: 8500,
      targetCpaBrl: 40,
      targetRoas: 6.0,
      isActive: true,
      isDemoData: true,
    },
    {
      id: "client-cfc-via-rapida",
      organizationId: DEMO_ORGANIZATION.id,
      name: "Autoescola & CFC Via Rápida",
      industry: "Educação & Serviços Locais",
      monthlyBudgetCapBrl: 5000,
      targetCpaBrl: 35,
      targetRoas: 5.5,
      isActive: true,
      isDemoData: true,
    },
    {
      id: "client-fiscaltech",
      organizationId: DEMO_ORGANIZATION.id,
      name: "Escritório Contábil FiscalTech B2B",
      industry: "Serviços B2B & Contabilidade",
      monthlyBudgetCapBrl: 6000,
      targetCpaBrl: 48,
      targetRoas: 4.0,
      isActive: true,
      isDemoData: true,
    },
    {
      id: "client-lumina-estetica",
      organizationId: DEMO_ORGANIZATION.id,
      name: "Studio Estética Avançada Lumina",
      industry: "Estética & Beleza",
      monthlyBudgetCapBrl: 5500,
      targetCpaBrl: 28,
      targetRoas: 6.8,
      isActive: true,
      isDemoData: true,
    },
    {
      id: "client-petvida",
      organizationId: DEMO_ORGANIZATION.id,
      name: "Hospital Veterinário 24h PetVida",
      industry: "Saúde Veterinária",
      monthlyBudgetCapBrl: 7500,
      targetCpaBrl: 32,
      targetRoas: 7.5,
      isActive: true,
      isDemoData: true,
    },
    {
      id: "client-primehouse",
      organizationId: DEMO_ORGANIZATION.id,
      name: "Imobiliária Alto Padrão PrimeHouse",
      industry: "Mercado Imobiliário",
      monthlyBudgetCapBrl: 4500,
      targetCpaBrl: 65,
      targetRoas: 3.5,
      isActive: true,
      isDemoData: true,
    },
  ];

  const adAccounts: readonly AdAccountRecordViewModel[] = [
    {
      id: "acc-demo-gads-sorriso",
      organizationId: DEMO_ORGANIZATION.id,
      clientId: "client-sorriso-prime",
      clientName: "Clínica Odontológica Sorriso Prime (SP)",
      provider: "MOCK_ADS",
      externalAccountId: "402-881-9001",
      managerCustomerId: "990-100-2000",
      isMccAccount: false,
      isSelectedForSync: true,
      name: "[DEMO] Google Ads — Sorriso Prime SP",
      currencyCode: "BRL",
      timezone: "America/Sao_Paulo",
      isDemoData: true,
    },
    {
      id: "acc-demo-gads-cfc",
      organizationId: DEMO_ORGANIZATION.id,
      clientId: "client-cfc-via-rapida",
      clientName: "Autoescola & CFC Via Rápida",
      provider: "MOCK_ADS",
      externalAccountId: "402-881-9002",
      managerCustomerId: "990-100-2000",
      isMccAccount: false,
      isSelectedForSync: true,
      name: "[DEMO] Google Ads — CFC Via Rápida",
      currencyCode: "BRL",
      timezone: "America/Sao_Paulo",
      isDemoData: true,
    },
  ];

  const members: readonly MemberRecordViewModel[] = [
    {
      id: "mem-owner-01",
      organizationId: DEMO_ORGANIZATION.id,
      userId: "user-owner-01",
      fullName: "Massami Shitara (Principal Owner)",
      email: "owner@konnexy.com.br",
      role: "OWNER",
      allowedClientIds: clients.map((c) => c.id),
    },
    {
      id: "mem-viewer-05",
      organizationId: DEMO_ORGANIZATION.id,
      userId: "user-viewer-05",
      fullName: "Dr. Ricardo Almeida (Cliente — Sorriso Prime)",
      email: "diretoria@sorrisoprime.com.br",
      role: "CLIENT_VIEWER",
      allowedClientIds: ["client-sorriso-prime"],
    },
  ];

  const integrations: readonly IntegrationHealthViewModel[] = [
    {
      id: "int-google-ads-prod",
      organizationId: DEMO_ORGANIZATION.id,
      provider: "GOOGLE_ADS",
      label: "Google Ads API v26 (OAuth 2.0 + MCC Read-Only)",
      status: "BLOCKED_MISSING_CREDENTIALS",
      mode: "READ_ONLY",
      managerCustomerId: "990-100-2000",
      lastSyncedAtIso: null,
      lastCheckpoint: null,
      latencyMs: googleHealth.latencyMs,
      message:
        "Bloqueado de forma transparente: GOOGLE_ADS_CLIENT_ID não configurado no ambiente. Nenhuma conexão real é simulada.",
      isDemoData: false,
    },
    {
      id: "int-mock-sandbox",
      organizationId: DEMO_ORGANIZATION.id,
      provider: "MOCK_ADS",
      label: "MockAdsProvider (Sandbox Demonstrativo Isolado)",
      status: "SANDBOX_DEMO",
      mode: "READ_ONLY",
      managerCustomerId: "990-100-2000",
      lastSyncedAtIso: "2026-11-26T10:15:00-03:00",
      lastCheckpoint: "ckpt-mock-20261126-v2",
      latencyMs: mockHealth.latencyMs,
      message: mockHealth.message,
      isDemoData: true,
    },
  ];

  return {
    organizationName: DEMO_ORGANIZATION.name,
    organizationId: DEMO_ORGANIZATION.id,
    defaultExecutionMode: "READ_ONLY",
    isDemoEnvironment: true,
    isServerKillSwitchPersisted: false,
    emergencyStopActive: false,
    organizations,
    clients,
    adAccounts,
    members,
    integrations,
    campaigns,
    dailyMetrics,
    recommendations,
    domainTables: ALL_DOMAIN_TABLES,
  };
}
