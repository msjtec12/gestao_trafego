import { z } from "zod";
import type { AdProviderType, CampaignStatus } from "@/domain/types";

// ============================================================================
// ZOD SCHEMAS & DISCRIMINATED UNIONS FOR MUTATION ACTIONS (PHASE E)
// ============================================================================

export const FinitePositiveMoneySchema = z
  .number()
  .refine((n) => Number.isFinite(n) && n > 0, {
    message: "Monetary value must be a finite positive number.",
  });

export const FiniteBudgetDeltaPctSchema = z
  .number()
  .refine((n) => Number.isFinite(n) && n !== 0 && Math.abs(n) <= 100, {
    message: "Budget delta percentage must be a finite non-zero number within ±100%.",
  });

export const PauseCampaignPayloadSchema = z.object({
  reason: z.string().min(3).max(240).default("Supervised pause requested"),
});

export const AdjustDailyBudgetPayloadSchema = z.object({
  currentDailyBudgetBrl: FinitePositiveMoneySchema.optional(),
  proposedDailyBudgetBrl: FinitePositiveMoneySchema,
  changePct: FiniteBudgetDeltaPctSchema.optional(),
});

export const AddNegativeKeywordPayloadSchema = z.object({
  negativeKeywords: z.array(z.string().min(2).max(120)).min(1),
  matchType: z.enum(["EXACT", "PHRASE", "BROAD"]).default("PHRASE"),
});

export const AdjustTargetCpaPayloadSchema = z.object({
  currentTargetCpaBrl: FinitePositiveMoneySchema.optional(),
  proposedTargetCpaBrl: FinitePositiveMoneySchema,
});

export const DiscriminatedMutationActionSchema = z.discriminatedUnion(
  "actionType",
  [
    z.object({
      actionType: z.literal("PAUSE_CAMPAIGN"),
      payload: PauseCampaignPayloadSchema,
    }),
    z.object({
      actionType: z.literal("ADJUST_DAILY_BUDGET"),
      payload: AdjustDailyBudgetPayloadSchema,
    }),
    z.object({
      actionType: z.literal("ADD_NEGATIVE_KEYWORD"),
      payload: AddNegativeKeywordPayloadSchema,
    }),
    z.object({
      actionType: z.literal("ADJUST_TARGET_CPA"),
      payload: AdjustTargetCpaPayloadSchema,
    }),
  ]
);

export type DiscriminatedMutationAction = z.infer<
  typeof DiscriminatedMutationActionSchema
>;

export type MutationActionType = DiscriminatedMutationAction["actionType"];

// ============================================================================
// NORMALIZED READ MODELS & TIME-WINDOW METRICS
// ============================================================================

export interface CampaignWindowMetrics {
  readonly windowDays: number;
  readonly spendBrl: number;
  readonly conversions: number;
  readonly cpaBrl: number;
  readonly roas: number;
  readonly ctrPct: number;
  readonly impressions: number;
  readonly clicks: number;
}

export interface NormalizedCampaign {
  readonly id: string;
  readonly organizationId: string;
  readonly clientId?: string;
  readonly externalCampaignId: string;
  readonly clientName: string;
  readonly name: string;
  readonly provider: AdProviderType;
  readonly channelType:
    | "SEARCH"
    | "PERFORMANCE_MAX"
    | "META_ADVANTAGE"
    | "LOCAL_SERVICES";
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
  readonly metricsByWindowDays?: Readonly<
    Record<number, CampaignWindowMetrics>
  >;
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
  readonly actionType: MutationActionType;
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

export interface PostExecutionVerificationResult {
  readonly verified: boolean;
  readonly provider: AdProviderType;
  readonly externalTransactionId: string;
  readonly observedState: Record<string, unknown>;
  readonly discrepancyReason?: string;
}

export class ProviderIntegrationError extends Error {
  constructor(
    public readonly provider: AdProviderType,
    public readonly errorCode:
      | "RATE_LIMIT_EXCEEDED"
      | "AUTH_TOKEN_REVOKED"
      | "PROVIDER_TIMEOUT"
      | "NOT_CONFIGURED_IN_FOUNDATION"
      | "POLICY_VIOLATION"
      | "VERIFICATION_MISMATCH",
    public readonly retryable: boolean,
    message: string
  ) {
    super(message);
    this.name = "ProviderIntegrationError";
  }
}

// ============================================================================
// SEPARATED READ vs. EXECUTION PROVIDER CONTRACTS (PHASE E.5)
// ============================================================================

export interface AdvertisingReadProvider {
  readonly providerType: AdProviderType;
  readonly isSimulated: boolean;
  checkHealth(organizationId: string): Promise<ProviderHealthStatus>;
  listCampaigns(organizationId: string): Promise<NormalizedCampaign[]>;
  getDailyMetrics(organizationId: string): Promise<NormalizedDailyMetric[]>;
}

export interface AdvertisingExecutionProvider {
  readonly providerType: AdProviderType;
  readonly isSimulated: boolean;
  simulateMutation(
    request: CampaignMutationRequest
  ): Promise<MutationSimulationResult>;
  executeMutation(
    request: CampaignMutationRequest
  ): Promise<MutationExecutionResult>;
  verifyMutation?(
    request: CampaignMutationRequest,
    executionResult: MutationExecutionResult
  ): Promise<PostExecutionVerificationResult>;
}

export interface AdvertisingProvider
  extends AdvertisingReadProvider,
    AdvertisingExecutionProvider {}
