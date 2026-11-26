import {
  type AdvertisingProvider,
  type CampaignMutationRequest,
  type MutationExecutionResult,
  type MutationSimulationResult,
  type NormalizedCampaign,
  type NormalizedDailyMetric,
  type PostExecutionVerificationResult,
  type ProviderHealthStatus,
  ProviderIntegrationError,
} from "../contracts/advertising-provider";

export interface MockProviderOptions {
  readonly simulateFailure?:
    | "RATE_LIMIT_EXCEEDED"
    | "AUTH_TOKEN_REVOKED"
    | "PROVIDER_TIMEOUT"
    | "VERIFICATION_MISMATCH";
}

export class MockAdsProvider implements AdvertisingProvider {
  public readonly providerType = "MOCK_ADS" as const;
  public readonly isSimulated = true;

  constructor(private readonly options: MockProviderOptions = {}) {}

  private checkSimulatedFailure(): void {
    if (!this.options.simulateFailure) return;

    if (this.options.simulateFailure === "RATE_LIMIT_EXCEEDED") {
      throw new ProviderIntegrationError(
        "MOCK_ADS",
        "RATE_LIMIT_EXCEEDED",
        true,
        "Rate limit exceeded (HTTP 429). Retry with exponential backoff."
      );
    }

    if (this.options.simulateFailure === "AUTH_TOKEN_REVOKED") {
      throw new ProviderIntegrationError(
        "MOCK_ADS",
        "AUTH_TOKEN_REVOKED",
        false,
        "OAuth refresh token has been revoked by the account owner (HTTP 401)."
      );
    }

    if (this.options.simulateFailure === "PROVIDER_TIMEOUT") {
      throw new ProviderIntegrationError(
        "MOCK_ADS",
        "PROVIDER_TIMEOUT",
        true,
        "Upstream provider timed out after 15000ms."
      );
    }
  }

  public async checkHealth(): Promise<ProviderHealthStatus> {
    this.checkSimulatedFailure();
    return {
      provider: "MOCK_ADS",
      connected: true,
      isDemoData: true,
      latencyMs: 18,
      message:
        "MockAdsProvider ativo — Dados demonstrativos claramente identificados (Sem conexão com contas reais nesta etapa).",
    };
  }

  public async listCampaigns(
    organizationId: string
  ): Promise<NormalizedCampaign[]> {
    this.checkSimulatedFailure();

    return [
      {
        id: "camp-demo-01",
        organizationId,
        clientId: "client-sorriso-prime",
        externalCampaignId: "GADS-99102-SEARCH",
        clientName: "Clínica Odontológica Sorriso Prime (SP)",
        name: "[DEMO] Search — Implantes & Invisalign Zona Sul",
        provider: "MOCK_ADS",
        channelType: "SEARCH",
        status: "ENABLED",
        biddingStrategy: "MAXIMIZE_CONVERSIONS_TARGET_CPA",
        dailyBudgetBrl: 220,
        spend7dBrl: 1480.5,
        conversions7d: 42,
        cpa7dBrl: 35.25,
        roas7d: 6.4,
        ctr7dPct: 7.85,
        impressions7d: 18900,
        clicks7d: 1484,
        metricsByWindowDays: {
          3: {
            windowDays: 3,
            spendBrl: 640,
            conversions: 18,
            cpaBrl: 35.55,
            roas: 6.3,
            ctrPct: 7.9,
            impressions: 8100,
            clicks: 640,
          },
          7: {
            windowDays: 7,
            spendBrl: 1480.5,
            conversions: 42,
            cpaBrl: 35.25,
            roas: 6.4,
            ctrPct: 7.85,
            impressions: 18900,
            clicks: 1484,
          },
          14: {
            windowDays: 14,
            spendBrl: 2950,
            conversions: 85,
            cpaBrl: 34.7,
            roas: 6.5,
            ctrPct: 7.8,
            impressions: 37800,
            clicks: 2948,
          },
          30: {
            windowDays: 30,
            spendBrl: 6200,
            conversions: 178,
            cpaBrl: 34.83,
            roas: 6.45,
            ctrPct: 7.75,
            impressions: 79000,
            clicks: 6122,
          },
        },
        isDemoData: true,
        lastAutomatedChangeAt: null,
      },
      {
        id: "camp-demo-02",
        organizationId,
        clientId: "client-cfc-via-rapida",
        externalCampaignId: "GADS-99108-PMAX",
        clientName: "Autoescola & CFC Via Rápida",
        name: "[DEMO] PMax — Primeira Habilitação A/B Local",
        provider: "MOCK_ADS",
        channelType: "PERFORMANCE_MAX",
        status: "LIMITED_BY_BUDGET",
        biddingStrategy: "MAXIMIZE_CONVERSION_VALUE",
        dailyBudgetBrl: 150,
        spend7dBrl: 1045.0,
        conversions7d: 38,
        cpa7dBrl: 27.5,
        roas7d: 5.8,
        ctr7dPct: 4.92,
        impressions7d: 32400,
        clicks7d: 1594,
        isDemoData: true,
        lastAutomatedChangeAt: null,
      },
      {
        id: "camp-demo-03",
        organizationId,
        clientId: "client-fiscaltech",
        externalCampaignId: "GADS-99115-SEARCH",
        clientName: "Escritório Contábil FiscalTech B2B",
        name: "[DEMO] Search — Abertura de Empresa & Migração MEI",
        provider: "MOCK_ADS",
        channelType: "SEARCH",
        status: "ENABLED",
        biddingStrategy: "TARGET_CPA",
        dailyBudgetBrl: 180,
        spend7dBrl: 1210.0,
        conversions7d: 14,
        cpa7dBrl: 86.42,
        roas7d: 2.1,
        ctr7dPct: 3.15,
        impressions7d: 14200,
        clicks7d: 447,
        metricsByWindowDays: {
          3: {
            windowDays: 3,
            spendBrl: 520,
            conversions: 5,
            cpaBrl: 104.0,
            roas: 1.8,
            ctrPct: 3.1,
            impressions: 6100,
            clicks: 189,
          },
          7: {
            windowDays: 7,
            spendBrl: 1210.0,
            conversions: 14,
            cpaBrl: 86.42,
            roas: 2.1,
            ctrPct: 3.15,
            impressions: 14200,
            clicks: 447,
          },
          30: {
            windowDays: 30,
            spendBrl: 4800.0,
            conversions: 96,
            cpaBrl: 50.0,
            roas: 4.2,
            ctrPct: 3.4,
            impressions: 58000,
            clicks: 1972,
          },
        },
        isDemoData: true,
        lastAutomatedChangeAt: null,
      },
      {
        id: "camp-demo-04",
        organizationId,
        clientId: "client-lumina-estetica",
        externalCampaignId: "META-88301-ADV",
        clientName: "Studio Estética Avançada Lumina",
        name: "[DEMO] Meta Advantage+ — Harmonização & Botox WhatsApp",
        provider: "MOCK_ADS",
        channelType: "META_ADVANTAGE",
        status: "ENABLED",
        biddingStrategy: "LOWEST_COST_CAP",
        dailyBudgetBrl: 160,
        spend7dBrl: 1090.0,
        conversions7d: 49,
        cpa7dBrl: 22.24,
        roas7d: 7.2,
        ctr7dPct: 2.84,
        impressions7d: 54100,
        clicks7d: 1536,
        isDemoData: true,
        lastAutomatedChangeAt: null,
      },
      {
        id: "camp-demo-05",
        organizationId,
        clientId: "client-petvida",
        externalCampaignId: "GADS-99142-LOCAL",
        clientName: "Hospital Veterinário 24h PetVida",
        name: "[DEMO] Search Emergência 24h — Raio 8km",
        provider: "MOCK_ADS",
        channelType: "LOCAL_SERVICES",
        status: "ENABLED",
        biddingStrategy: "MAXIMIZE_CONVERSIONS",
        dailyBudgetBrl: 250,
        spend7dBrl: 1715.0,
        conversions7d: 61,
        cpa7dBrl: 28.11,
        roas7d: 8.1,
        ctr7dPct: 9.4,
        impressions7d: 15600,
        clicks7d: 1466,
        isDemoData: true,
        lastAutomatedChangeAt: null,
      },
      {
        id: "camp-demo-06",
        organizationId,
        clientId: "client-primehouse",
        externalCampaignId: "GADS-99199-BROAD",
        clientName: "Imobiliária Alto Padrão PrimeHouse",
        name: "[DEMO] Search — Termos Amplos Genéricos (Alerta CPA)",
        provider: "MOCK_ADS",
        channelType: "SEARCH",
        status: "LEARNING",
        biddingStrategy: "MAXIMIZE_CLICKS",
        dailyBudgetBrl: 140,
        spend7dBrl: 940.0,
        conversions7d: 5,
        cpa7dBrl: 188.0,
        roas7d: 1.15,
        ctr7dPct: 1.9,
        impressions7d: 26300,
        clicks7d: 500,
        isDemoData: true,
        lastAutomatedChangeAt: null,
      },
      {
        id: "camp-demo-07",
        organizationId,
        clientId: "client-sorriso-prime",
        externalCampaignId: "META-88390-REMARKETING",
        clientName: "Clínica Odontológica Sorriso Prime (SP)",
        name: "[DEMO] Remarketing 30d — Avaliações Agendadas",
        provider: "MOCK_ADS",
        channelType: "META_ADVANTAGE",
        status: "PAUSED",
        biddingStrategy: "LOWEST_COST",
        dailyBudgetBrl: 75,
        spend7dBrl: 310.0,
        conversions7d: 11,
        cpa7dBrl: 28.18,
        roas7d: 5.5,
        ctr7dPct: 3.45,
        impressions7d: 11200,
        clicks7d: 386,
        isDemoData: true,
        lastAutomatedChangeAt: null,
      },
    ];
  }

  public async getDailyMetrics(): Promise<NormalizedDailyMetric[]> {
    this.checkSimulatedFailure();

    return [
      {
        date: "2026-11-20",
        label: "20/Nov",
        spendBrl: 1020,
        conversions: 28,
        cpaBrl: 36.43,
        roas: 5.4,
        clicks: 980,
        impressions: 21400,
        isDemoData: true,
      },
      {
        date: "2026-11-21",
        label: "21/Nov",
        spendBrl: 1140,
        conversions: 33,
        cpaBrl: 34.55,
        roas: 5.8,
        clicks: 1090,
        impressions: 23800,
        isDemoData: true,
      },
      {
        date: "2026-11-22",
        label: "22/Nov",
        spendBrl: 980,
        conversions: 26,
        cpaBrl: 37.69,
        roas: 5.1,
        clicks: 920,
        impressions: 20100,
        isDemoData: true,
      },
      {
        date: "2026-11-23",
        label: "23/Nov",
        spendBrl: 1085,
        conversions: 31,
        cpaBrl: 35.0,
        roas: 5.9,
        clicks: 1045,
        impressions: 22900,
        isDemoData: true,
      },
      {
        date: "2026-11-24",
        label: "24/Nov",
        spendBrl: 1190,
        conversions: 36,
        cpaBrl: 33.05,
        roas: 6.3,
        clicks: 1170,
        impressions: 25600,
        isDemoData: true,
      },
      {
        date: "2026-11-25",
        label: "25/Nov",
        spendBrl: 1215,
        conversions: 34,
        cpaBrl: 35.73,
        roas: 6.1,
        clicks: 1120,
        impressions: 24900,
        isDemoData: true,
      },
      {
        date: "2026-11-26",
        label: "26/Nov",
        spendBrl: 1160.5,
        conversions: 32,
        cpaBrl: 36.26,
        roas: 6.2,
        clicks: 1088,
        impressions: 23800,
        isDemoData: true,
      },
    ];
  }

  public async simulateMutation(
    request: CampaignMutationRequest
  ): Promise<MutationSimulationResult> {
    this.checkSimulatedFailure();
    return {
      isDemoData: true,
      projectedMonthlyDeltaBrl: -420.0,
      projectedCpaChangePct: -14.5,
      summary: `[SIMULAÇÃO MOCK] Ação '${request.actionType}' na campanha '${request.campaignId}' projeta redução de CPA em 14,5% sem perda de volume qualificado.`,
    };
  }

  public async executeMutation(
    request: CampaignMutationRequest
  ): Promise<MutationExecutionResult> {
    this.checkSimulatedFailure();
    return {
      success: true,
      provider: "MOCK_ADS",
      isDemoData: true,
      externalTransactionId: `mock-tx-${request.idempotencyKey}`,
      executedAt: new Date().toISOString(),
      verifiedState: {
        campaignId: request.campaignId,
        actionType: request.actionType,
        appliedPayload: request.payload,
        isSimulatedSandbox: true,
      },
    };
  }

  public async verifyMutation(
    request: CampaignMutationRequest,
    executionResult: MutationExecutionResult
  ): Promise<PostExecutionVerificationResult> {
    if (this.options.simulateFailure === "VERIFICATION_MISMATCH") {
      return {
        verified: false,
        provider: "MOCK_ADS",
        externalTransactionId: executionResult.externalTransactionId,
        observedState: { campaignId: request.campaignId, status: "DRIFT_DETECTED" },
        discrepancyReason:
          "Post-execution verification detected state drift between requested payload and provider state.",
      };
    }

    return {
      verified:
        executionResult.success &&
        executionResult.verifiedState.campaignId === request.campaignId &&
        executionResult.verifiedState.actionType === request.actionType,
      provider: "MOCK_ADS",
      externalTransactionId: executionResult.externalTransactionId,
      observedState: executionResult.verifiedState,
    };
  }
}

export class GoogleAdsProvider implements AdvertisingProvider {
  public readonly providerType = "GOOGLE_ADS" as const;
  public readonly isSimulated = false;

  public async checkHealth(): Promise<ProviderHealthStatus> {
    return {
      provider: "GOOGLE_ADS",
      connected: false,
      isDemoData: false,
      latencyMs: 0,
      message:
        "GoogleAdsProvider desativado na Etapa 1 (Foundation). Nenhuma conta real conectada por requisito de segurança.",
    };
  }

  public async listCampaigns(): Promise<NormalizedCampaign[]> {
    throw new ProviderIntegrationError(
      "GOOGLE_ADS",
      "NOT_CONFIGURED_IN_FOUNDATION",
      false,
      "GoogleAdsProvider real account connection is intentionally disabled during Foundation stage."
    );
  }

  public async getDailyMetrics(): Promise<NormalizedDailyMetric[]> {
    throw new ProviderIntegrationError(
      "GOOGLE_ADS",
      "NOT_CONFIGURED_IN_FOUNDATION",
      false,
      "GoogleAdsProvider real account connection is intentionally disabled during Foundation stage."
    );
  }

  public async simulateMutation(): Promise<MutationSimulationResult> {
    throw new ProviderIntegrationError(
      "GOOGLE_ADS",
      "NOT_CONFIGURED_IN_FOUNDATION",
      false,
      "GoogleAdsProvider real account connection is intentionally disabled during Foundation stage."
    );
  }

  public async executeMutation(): Promise<MutationExecutionResult> {
    throw new ProviderIntegrationError(
      "GOOGLE_ADS",
      "NOT_CONFIGURED_IN_FOUNDATION",
      false,
      "GoogleAdsProvider real account connection is intentionally disabled during Foundation stage."
    );
  }
}
