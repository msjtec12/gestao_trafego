import type {
  AdAccountRecordViewModel,
  IntegrationHealthViewModel,
  SyncRunViewModel,
} from "./dashboard-overview-use-case";
import type {
  PersistedExecutiveReport,
  PersistedRecommendationWithApproval,
} from "@/infrastructure/db/repositories/ai-recommendations-reports-repository";

export interface CommercialClientViewModel {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly industry: string;
  readonly websiteUrl: string | null;
  readonly monthlyBudgetCapBrl: number;
  readonly targetCpaBrl: number | null;
  readonly targetRoas: number | null;
  readonly isActive: boolean;
  readonly isDemoData: boolean;
  readonly createdAtIso: string;
}

export type OnboardingStepStatus =
  | "CONCLUIDO"
  | "PENDENTE"
  | "BLOQUEADO_CREDENCIAIS";

export interface GuidedOnboardingStep {
  readonly stepNumber: number;
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: OnboardingStepStatus;
  readonly actionHref: string;
  readonly actionLabel: string;
  readonly credentialNote?: string;
}

export type CommercialIntegrationStatus =
  | "NAO_CONFIGURADO"
  | "AGUARDANDO_AUTORIZACAO"
  | "CONECTADO"
  | "SINCRONIZANDO"
  | "FALHA"
  | "CREDENCIAL_EXPIRADA"
  | "EM_DESENVOLVIMENTO";

export interface IntegrationCardItem {
  readonly id: string;
  readonly providerKey: "GOOGLE_ADS" | "META_ADS" | "GA4" | "GSC";
  readonly name: string;
  readonly subtitle: string;
  readonly modeLabel: string;
  readonly status: CommercialIntegrationStatus;
  readonly statusLabel: string;
  readonly detailMessage: string;
  readonly lastSyncedAtIso: string | null;
  readonly isOperational: boolean;
  readonly canConnect: boolean;
  readonly connectHref?: string;
  readonly integrationId?: string;
}

export function isGoogleAdsOAuthEnvReady(
  rawEnv: Record<string, string | undefined> = process.env
): boolean {
  const clientId = rawEnv.GOOGLE_ADS_CLIENT_ID?.trim() ?? "";
  const clientSecret = rawEnv.GOOGLE_ADS_CLIENT_SECRET?.trim() ?? "";
  const devToken = rawEnv.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() ?? "";
  return Boolean(
    clientId &&
      clientSecret &&
      devToken &&
      !clientId.includes("replace_with") &&
      !clientSecret.includes("replace_with") &&
      !devToken.includes("replace_with")
  );
}

export function buildIntegrationCatalog(params: {
  readonly integrations: readonly IntegrationHealthViewModel[];
  readonly syncHistory: readonly SyncRunViewModel[];
  readonly isGoogleAdsOAuthConfigured: boolean;
}): readonly IntegrationCardItem[] {
  const google = params.integrations.find((i) => i.provider === "GOOGLE_ADS");
  const isGoogleSyncing = params.syncHistory.some(
    (s) => s.provider === "GOOGLE_ADS" && s.status === "RUNNING"
  );

  let googleStatus: CommercialIntegrationStatus = "NAO_CONFIGURADO";
  let googleLabel = "Não configurado";
  let googleDetail =
    "Credenciais OAuth 2.0 e Developer Token do Google Ads ainda não configurados no ambiente.";

  if (isGoogleSyncing) {
    googleStatus = "SINCRONIZANDO";
    googleLabel = "Sincronizando";
    googleDetail = "Sincronização incremental READ_ONLY em andamento.";
  } else if (!params.isGoogleAdsOAuthConfigured) {
    googleStatus = "NAO_CONFIGURADO";
    googleLabel = "Não configurado";
    googleDetail =
      "Configure GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET e GOOGLE_ADS_DEVELOPER_TOKEN na Vercel para habilitar a autorização OAuth 2.0.";
  } else if (google?.status === "CONNECTED") {
    googleStatus = "CONECTADO";
    googleLabel = "Conectado";
    googleDetail =
      "Conectado via Google Ads API v26 em modo seguro somente leitura (READ_ONLY).";
  } else if (google?.status === "EXPIRED") {
    googleStatus = "CREDENCIAL_EXPIRADA";
    googleLabel = "Credencial expirada";
    googleDetail =
      "O token OAuth expirou. Reautorize a conta Google Ads para retomar a sincronização.";
  } else if (google?.status === "ERROR") {
    googleStatus = google.lastSyncedAtIso ? "FALHA" : "AGUARDANDO_AUTORIZACAO";
    googleLabel = google.lastSyncedAtIso
      ? "Falha"
      : "Aguardando autorização";
    googleDetail = google.lastSyncedAtIso
      ? google.message
      : "Credenciais configuradas. Clique em Conectar Google Ads para concluir o OAuth 2.0 (READ_ONLY).";
  } else {
    googleStatus = "AGUARDANDO_AUTORIZACAO";
    googleLabel = "Aguardando autorização";
    googleDetail =
      "Pronto para autorização OAuth 2.0 em modo somente leitura.";
  }

  return [
    {
      id: google?.id ?? "google-ads-primary",
      providerKey: "GOOGLE_ADS",
      name: "Google Ads",
      subtitle: "Campanhas de Pesquisa, Performance Max, Display e YouTube",
      modeLabel: "Somente Leitura (READ_ONLY)",
      status: googleStatus,
      statusLabel: googleLabel,
      detailMessage: googleDetail,
      lastSyncedAtIso: google?.lastSyncedAtIso ?? null,
      isOperational: true,
      canConnect: params.isGoogleAdsOAuthConfigured,
      connectHref: "/api/integrations/google-ads/authorize",
      integrationId: google?.id,
    },
    {
      id: "meta-ads-roadmap",
      providerKey: "META_ADS",
      name: "Meta Ads",
      subtitle: "Facebook & Instagram Ads (Marketing API)",
      modeLabel: "Conector em desenvolvimento",
      status: "EM_DESENVOLVIMENTO",
      statusLabel: "Em desenvolvimento",
      detailMessage:
        "Integração planejada para a próxima etapa. Nenhuma coleta ou alteração está ativa para Meta Ads.",
      lastSyncedAtIso: null,
      isOperational: false,
      canConnect: false,
    },
    {
      id: "ga4-roadmap",
      providerKey: "GA4",
      name: "Google Analytics 4",
      subtitle: "Atribuição de conversões, eventos e engajamento de landing pages",
      modeLabel: "Conector em desenvolvimento",
      status: "EM_DESENVOLVIMENTO",
      statusLabel: "Em desenvolvimento",
      detailMessage:
        "Integração planejada para cruzar dados de sessão e conversão do GA4 com campanhas pagas.",
      lastSyncedAtIso: null,
      isOperational: false,
      canConnect: false,
    },
    {
      id: "gsc-roadmap",
      providerKey: "GSC",
      name: "Google Search Console",
      subtitle: "Consultas orgânicas, páginas de destino e cobertura de termos",
      modeLabel: "Conector em desenvolvimento",
      status: "EM_DESENVOLVIMENTO",
      statusLabel: "Em desenvolvimento",
      detailMessage:
        "Integração planejada para comparar termos orgânicos e pagos sem canibalização.",
      lastSyncedAtIso: null,
      isOperational: false,
      canConnect: false,
    },
  ];
}

export function buildGuidedOnboardingChecklist(params: {
  readonly organizationName: string;
  readonly organizationTimezone: string;
  readonly clients: readonly CommercialClientViewModel[];
  readonly adAccounts: readonly AdAccountRecordViewModel[];
  readonly integrations: readonly IntegrationHealthViewModel[];
  readonly syncHistory: readonly SyncRunViewModel[];
  readonly persistedRecommendations: readonly PersistedRecommendationWithApproval[];
  readonly executiveReports: readonly PersistedExecutiveReport[];
  readonly isGoogleAdsOAuthConfigured: boolean;
}): readonly GuidedOnboardingStep[] {
  const hasOrgProfile =
    params.organizationName.trim().length >= 2 &&
    params.organizationTimezone.trim().length > 0;
  const hasClient = params.clients.length > 0;
  const hasCommercialObjectives = params.clients.some(
    (c) => c.industry.trim().length >= 3 && Boolean(c.websiteUrl?.trim())
  );
  const hasBudgetAndGoals = params.clients.some(
    (c) =>
      c.monthlyBudgetCapBrl > 0 &&
      (c.targetCpaBrl !== null || c.targetRoas !== null)
  );
  const googleConnected = params.integrations.some(
    (i) => i.provider === "GOOGLE_ADS" && i.status === "CONNECTED"
  );
  const hasSelectedAccount = params.adAccounts.some(
    (a) => a.isSelectedForSync
  );
  const hasCompletedSync = params.syncHistory.some(
    (s) => s.status === "COMPLETED"
  );
  const hasRecommendations = params.persistedRecommendations.length > 0;
  const hasReport = params.executiveReports.length > 0;

  return [
    {
      stepNumber: 1,
      id: "org-profile",
      title: "Completar perfil da organização",
      description:
        "Verifique o nome da agência/empresa, fuso horário e moeda padrão.",
      status: hasOrgProfile ? "CONCLUIDO" : "PENDENTE",
      actionHref: "/configuracoes",
      actionLabel: "Revisar perfil",
    },
    {
      stepNumber: 2,
      id: "first-client",
      title: "Cadastrar primeiro cliente",
      description:
        "Crie a carteira comercial do seu primeiro cliente para vincular contas e metas.",
      status: hasClient ? "CONCLUIDO" : "PENDENTE",
      actionHref: "/clientes",
      actionLabel: "Cadastrar cliente",
    },
    {
      stepNumber: 3,
      id: "commercial-objectives",
      title: "Definir objetivos comerciais",
      description:
        "Informe segmento e site oficial do cliente para contextualizar análises e relatórios.",
      status: hasCommercialObjectives ? "CONCLUIDO" : "PENDENTE",
      actionHref: hasClient
        ? `/clientes/${params.clients[0]!.id}`
        : "/clientes",
      actionLabel: "Definir objetivos",
    },
    {
      stepNumber: 4,
      id: "budget-and-goals",
      title: "Configurar orçamento e metas",
      description:
        "Defina teto mensal de investimento, CPA desejado e ROAS alvo quando aplicável.",
      status: hasBudgetAndGoals ? "CONCLUIDO" : "PENDENTE",
      actionHref: "/orcamentos",
      actionLabel: "Configurar metas",
    },
    {
      stepNumber: 5,
      id: "connect-google-ads",
      title: "Conectar Google Ads",
      description:
        "Autorize a conexão oficial Google Ads API v26 em modo somente leitura (READ_ONLY).",
      status: googleConnected
        ? "CONCLUIDO"
        : params.isGoogleAdsOAuthConfigured
          ? "PENDENTE"
          : "BLOQUEADO_CREDENCIAIS",
      actionHref: "/integracoes",
      actionLabel: "Ir para Integrações",
      credentialNote: !params.isGoogleAdsOAuthConfigured
        ? "Depende das variáveis GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET e GOOGLE_ADS_DEVELOPER_TOKEN."
        : undefined,
    },
    {
      stepNumber: 6,
      id: "select-ad-account",
      title: "Selecionar conta de anúncios",
      description:
        "Escolha quais contas vinculadas à MCC serão sincronizadas para o cliente.",
      status: hasSelectedAccount
        ? "CONCLUIDO"
        : googleConnected
          ? "PENDENTE"
          : "BLOQUEADO_CREDENCIAIS",
      actionHref: "/integracoes",
      actionLabel: "Gerenciar contas",
      credentialNote: !googleConnected
        ? "Disponível após conectar o Google Ads."
        : undefined,
    },
    {
      stepNumber: 7,
      id: "first-sync",
      title: "Executar primeira sincronização",
      description:
        "Importe campanhas, grupos, anúncios, palavras-chave, termos e métricas reais.",
      status: hasCompletedSync
        ? "CONCLUIDO"
        : googleConnected && hasSelectedAccount
          ? "PENDENTE"
          : "BLOQUEADO_CREDENCIAIS",
      actionHref: "/integracoes",
      actionLabel: "Sincronizar agora",
      credentialNote: !googleConnected
        ? "Depende de uma conta Google Ads conectada."
        : undefined,
    },
    {
      stepNumber: 8,
      id: "analyze-campaigns",
      title: "Analisar campanhas",
      description:
        "Execute a Central de Inteligência Artificial para gerar recomendações com evidências.",
      status: hasRecommendations ? "CONCLUIDO" : "PENDENTE",
      actionHref: "/ia",
      actionLabel: "Abrir Central de IA",
    },
    {
      stepNumber: 9,
      id: "first-report",
      title: "Gerar primeiro relatório",
      description:
        "Crie um relatório comercial executivo por cliente com exportação em PDF.",
      status: hasReport ? "CONCLUIDO" : "PENDENTE",
      actionHref: "/relatorios",
      actionLabel: "Gerar relatório",
    },
  ];
}
