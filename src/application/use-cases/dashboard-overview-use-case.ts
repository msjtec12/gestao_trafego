import type { AdProviderType, UserRole } from "@/domain/types";
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
  readonly status: "CONNECTED" | "EXPIRED" | "REVOKED" | "ERROR" | "SANDBOX_DEMO" | "BLOCKED_MISSING_CREDENTIALS";
  readonly mode: "READ_ONLY";
  readonly managerCustomerId: string | null;
  readonly lastSyncedAtIso: string | null;
  readonly lastCheckpoint: string | null;
  readonly latencyMs: number;
  readonly message: string;
  readonly isDemoData: boolean;
}

export interface DashboardOverviewViewModel {
  readonly organizationName: string;
  readonly organizationId: string;
  readonly defaultExecutionMode: "READ_ONLY";
  readonly isDemoEnvironment: boolean;
  readonly isServerKillSwitchPersisted: false;
  readonly organizations: readonly OrganizationOption[];
  readonly clients: readonly ClientRecordViewModel[];
  readonly adAccounts: readonly AdAccountRecordViewModel[];
  readonly members: readonly MemberRecordViewModel[];
  readonly integrations: readonly IntegrationHealthViewModel[];
  readonly campaigns: NormalizedCampaign[];
  readonly dailyMetrics: NormalizedDailyMetric[];
  readonly recommendations: AIRecommendation[];
  readonly domainTables: readonly string[];
}

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

  const hasLiveGoogleCredentials = Boolean(
    process.env.GOOGLE_ADS_CLIENT_ID &&
      !process.env.GOOGLE_ADS_CLIENT_ID.startsWith("replace_with_") &&
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      !process.env.GOOGLE_ADS_DEVELOPER_TOKEN.startsWith("replace_with_")
  );

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
    {
      id: "acc-demo-gads-fiscaltech",
      organizationId: DEMO_ORGANIZATION.id,
      clientId: "client-fiscaltech",
      clientName: "Escritório Contábil FiscalTech B2B",
      provider: "MOCK_ADS",
      externalAccountId: "402-881-9003",
      managerCustomerId: "990-100-2000",
      isMccAccount: false,
      isSelectedForSync: true,
      name: "[DEMO] Google Ads — FiscalTech B2B",
      currencyCode: "BRL",
      timezone: "America/Sao_Paulo",
      isDemoData: true,
    },
    {
      id: "acc-demo-meta-lumina",
      organizationId: DEMO_ORGANIZATION.id,
      clientId: "client-lumina-estetica",
      clientName: "Studio Estética Avançada Lumina",
      provider: "MOCK_ADS",
      externalAccountId: "ACT-8830199",
      managerCustomerId: null,
      isMccAccount: false,
      isSelectedForSync: true,
      name: "[DEMO] Meta Ads — Studio Lumina",
      currencyCode: "BRL",
      timezone: "America/Sao_Paulo",
      isDemoData: true,
    },
    {
      id: "acc-demo-gads-petvida",
      organizationId: DEMO_ORGANIZATION.id,
      clientId: "client-petvida",
      clientName: "Hospital Veterinário 24h PetVida",
      provider: "MOCK_ADS",
      externalAccountId: "402-881-9005",
      managerCustomerId: "990-100-2000",
      isMccAccount: false,
      isSelectedForSync: true,
      name: "[DEMO] Google Ads — Hospital PetVida 24h",
      currencyCode: "BRL",
      timezone: "America/Sao_Paulo",
      isDemoData: true,
    },
    {
      id: "acc-demo-gads-primehouse",
      organizationId: DEMO_ORGANIZATION.id,
      clientId: "client-primehouse",
      clientName: "Imobiliária Alto Padrão PrimeHouse",
      provider: "MOCK_ADS",
      externalAccountId: "402-881-9006",
      managerCustomerId: "990-100-2000",
      isMccAccount: false,
      isSelectedForSync: true,
      name: "[DEMO] Google Ads — Imobiliária PrimeHouse",
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
      id: "mem-admin-02",
      organizationId: DEMO_ORGANIZATION.id,
      userId: "user-admin-02",
      fullName: "Helena Costa (Head de Operações)",
      email: "helena.admin@konnexy.com.br",
      role: "ADMIN",
      allowedClientIds: clients.map((c) => c.id),
    },
    {
      id: "mem-traffic-03",
      organizationId: DEMO_ORGANIZATION.id,
      userId: "user-traffic-03",
      fullName: "Lucas Mendes (Gestor de Tráfego Sênior)",
      email: "lucas.trafego@konnexy.com.br",
      role: "TRAFFIC_MANAGER",
      allowedClientIds: clients.map((c) => c.id),
    },
    {
      id: "mem-analyst-04",
      organizationId: DEMO_ORGANIZATION.id,
      userId: "user-analyst-04",
      fullName: "Marina Rocha (Analista de BI & Mídia)",
      email: "marina.bi@konnexy.com.br",
      role: "ANALYST",
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
      label: "Google Ads API v19 (OAuth 2.0 + MCC Read-Only)",
      status: hasLiveGoogleCredentials
        ? "CONNECTED"
        : "BLOCKED_MISSING_CREDENTIALS",
      mode: "READ_ONLY",
      managerCustomerId: "990-100-2000",
      lastSyncedAtIso: null,
      lastCheckpoint: null,
      latencyMs: googleHealth.latencyMs,
      message: hasLiveGoogleCredentials
        ? "Credenciais OAuth 2.0 configuradas em modo READ_ONLY."
        : "Bloqueado de forma transparente: GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_DEVELOPER_TOKEN não configurados no ambiente. Nenhuma conexão real é simulada.",
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
