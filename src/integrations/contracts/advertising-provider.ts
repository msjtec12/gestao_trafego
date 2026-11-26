import type { AdProviderType, CampaignStatus } from "@/domain/types";

export interface NormalizedCampaign {
  readonly id: string;
  readonly organizationId: string;
  readonly externalCampaignId: string;
  readonly clientName: string;
  readonly name: string;
  readonly provider: AdProviderType;
  readonly channelType: "SEARCH" | "PERFORMANCE_MAX" | "META_ADVANTAGE" | "LOCAL_SERVICES";
  readonly status: CampaignStatus;
  readonly biddingStrategy: string;
  readonly dailyBudgetBrl: number;
  readonly spend7dBrl: number;
  readonly conversions7d: number;
  readonly cpa7dBrl: number;
  readonly roas7d: number;
  readonly ctr7dPct: number;
  readonly impressions7d: number;
  readonly clicks7d: number;
  readonly isDemoData: boolean;
  readonly lastAutomatedChangeAt: string | null;
}

export interface NormalizedDailyMetric {
  readonly date: string;
  readonly label: string;
  readonly spendBrl: number;
  readonly conversions: number;
  readonly cpaBrl: number;
  readonly roas: number;
  readonly clicks: number;
  readonly impressions: number;
  readonly isDemoData: boolean;
}

export interface ProviderHealthStatus {
  readonly provider: AdProviderType;
  readonly connected: boolean;
  readonly isDemoData: boolean;
  readonly latencyMs: number;
  readonly message: string;
}

export interface CampaignMutationRequest {
  readonly organizationId: string;
  readonly campaignId: string;
  readonly actionType:
    | "PAUSE_CAMPAIGN"
    | "ADJUST_DAILY_BUDGET"
    | "ADD_NEGATIVE_KEYWORD"
    | "ADJUST_TARGET_CPA";
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
}

export interface MutationSimulationResult {
  readonly isDemoData: boolean;
  readonly projectedMonthlyDeltaBrl: number;
  readonly projectedCpaChangePct: number;
  readonly summary: string;
}

export interface MutationExecutionResult {
  readonly success: boolean;
  readonly provider: AdProviderType;
  readonly isDemoData: boolean;
  readonly externalTransactionId: string;
  readonly executedAt: string;
  readonly verifiedState: Record<string, unknown>;
}

export class ProviderIntegrationError extends Error {
  constructor(
    public readonly provider: AdProviderType,
    public readonly errorCode:
      | "RATE_LIMIT_EXCEEDED"
      | "AUTH_TOKEN_REVOKED"
      | "PROVIDER_TIMEOUT"
      | "NOT_CONFIGURED_IN_FOUNDATION"
      | "POLICY_VIOLATION",
    public readonly retryable: boolean,
    message: string
  ) {
    super(message);
    this.name = "ProviderIntegrationError";
  }
}

export interface AdvertisingProvider {
  readonly providerType: AdProviderType;
  readonly isSimulated: boolean;
  checkHealth(organizationId: string): Promise<ProviderHealthStatus>;
  listCampaigns(organizationId: string): Promise<NormalizedCampaign[]>;
  getDailyMetrics(organizationId: string): Promise<NormalizedDailyMetric[]>;
  simulateMutation(
    request: CampaignMutationRequest
  ): Promise<MutationSimulationResult>;
  executeMutation(
    request: CampaignMutationRequest
  ): Promise<MutationExecutionResult>;
}
