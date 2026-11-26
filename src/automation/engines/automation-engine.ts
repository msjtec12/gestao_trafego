import type {
  AutomationStage,
  ExecutionMode,
  RiskLevel,
  TenantContext,
} from "@/domain/types";
import type {
  AdvertisingProvider,
  CampaignMutationRequest,
  MutationExecutionResult,
  NormalizedCampaign,
} from "@/integrations/contracts/advertising-provider";
import { assertPermission, assertTenantAccess } from "@/security/rbac-and-tenant";

export interface AutomationRuleDefinition {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly isEnabled: boolean;
  readonly timeWindowDays: number;
  readonly minImpressions: number;
  readonly minClicks: number;
  readonly minSpendBrl: number;
  readonly maxBudgetChangePct: number;
  readonly cooldownMinutes: number;
  readonly condition: {
    readonly maxAllowedCpaBrl?: number;
    readonly minRequiredRoas?: number;
  };
  readonly proposedAction: {
    readonly actionType: CampaignMutationRequest["actionType"];
    readonly budgetDeltaPct?: number;
  };
}

export interface RuleEvaluationOutput {
  readonly matched: boolean;
  readonly stageReached: AutomationStage;
  readonly reason: string;
  readonly riskLevel: RiskLevel;
  readonly requiresApproval: boolean;
}

export interface AuditLogEntry {
  readonly id: string;
  readonly organizationId: string;
  readonly timestamp: string;
  readonly stage: AutomationStage;
  readonly actor: string;
  readonly action: string;
  readonly campaignId: string;
  readonly details: string;
}

const RESTRICTED_PRODUCT_KEYWORDS = [
  "cassino ilegal",
  "apostas sem licenca",
  "armas de fogo",
  "documentos falsos",
  "cura milagrosa garantida",
  "substancias ilicitas",
];

// ============================================================================
// 1. POLICY ENGINE & RESTRICTED CONTENT BLOCKER
// ============================================================================

export class PolicyEngine {
  public validateCampaignContent(textToInspect: string): {
    allowed: boolean;
    violationReason?: string;
  } {
    const normalized = textToInspect.toLowerCase();
    for (const restricted of RESTRICTED_PRODUCT_KEYWORDS) {
      if (normalized.includes(restricted)) {
        return {
          allowed: false,
          violationReason: `Restricted product/service blocked by PolicyEngine: matched '${restricted}'.`,
        };
      }
    }
    return { allowed: true };
  }

  public validateFinancialLimit(
    requestedChangePct: number,
    organizationMaxPct: number
  ): { allowed: boolean; violationReason?: string } {
    if (Math.abs(requestedChangePct) > organizationMaxPct) {
      return {
        allowed: false,
        violationReason: `Budget change of ${requestedChangePct}% exceeds organization financial limit of ±${organizationMaxPct}%.`,
      };
    }
    return { allowed: true };
  }
}

// ============================================================================
// 2. RISK ENGINE
// ============================================================================

export class RiskEngine {
  public classifyRisk(
    actionType: CampaignMutationRequest["actionType"],
    budgetDeltaPct = 0
  ): RiskLevel {
    if (actionType === "PAUSE_CAMPAIGN") {
      return "HIGH";
    }
    if (actionType === "ADJUST_DAILY_BUDGET") {
      const absDelta = Math.abs(budgetDeltaPct);
      if (absDelta > 20) return "CRITICAL";
      if (absDelta > 10) return "MEDIUM";
      return "LOW";
    }
    if (actionType === "ADJUST_TARGET_CPA") {
      return "MEDIUM";
    }
    return "LOW";
  }
}

// ============================================================================
// 3. RULE ENGINE (Minimum Data, Time Window, Cooldown & Composite Conditions)
// ============================================================================

export class RuleEngine {
  private readonly policyEngine = new PolicyEngine();
  private readonly riskEngine = new RiskEngine();

  public evaluateCampaign(
    context: TenantContext,
    rule: AutomationRuleDefinition,
    campaign: NormalizedCampaign,
    now: Date = new Date()
  ): RuleEvaluationOutput {
    assertTenantAccess(context, rule.organizationId);
    assertTenantAccess(context, campaign.organizationId);

    const contentPolicy = this.policyEngine.validateCampaignContent(
      campaign.name
    );
    if (!contentPolicy.allowed) {
      return {
        matched: false,
        stageReached: "VALIDATION",
        reason: contentPolicy.violationReason ?? "Policy violation",
        riskLevel: "CRITICAL",
        requiresApproval: true,
      };
    }

    // Minimum Data Guardrails
    if (
      campaign.impressions7d < rule.minImpressions ||
      campaign.clicks7d < rule.minClicks ||
      campaign.spend7dBrl < rule.minSpendBrl
    ) {
      return {
        matched: false,
        stageReached: "ANALYSIS",
        reason: `Insufficient statistical sample in ${rule.timeWindowDays}d window (min ${rule.minImpressions} impr, ${rule.minClicks} clicks, R$ ${rule.minSpendBrl} spend).`,
        riskLevel: "LOW",
        requiresApproval: true,
      };
    }

    // Cooldown Guardrail
    if (campaign.lastAutomatedChangeAt) {
      const lastChangeMs = new Date(campaign.lastAutomatedChangeAt).getTime();
      const elapsedMinutes = (now.getTime() - lastChangeMs) / (1000 * 60);
      if (elapsedMinutes < rule.cooldownMinutes) {
        return {
          matched: false,
          stageReached: "VALIDATION",
          reason: `Cooldown active: ${Math.round(elapsedMinutes)}m elapsed of required ${rule.cooldownMinutes}m.`,
          riskLevel: "LOW",
          requiresApproval: true,
        };
      }
    }

    // Financial Limit Guardrail
    const deltaPct = rule.proposedAction.budgetDeltaPct ?? 0;
    const financialPolicy = this.policyEngine.validateFinancialLimit(
      deltaPct,
      rule.maxBudgetChangePct
    );
    if (!financialPolicy.allowed) {
      return {
        matched: false,
        stageReached: "VALIDATION",
        reason: financialPolicy.violationReason ?? "Financial limit exceeded",
        riskLevel: "CRITICAL",
        requiresApproval: true,
      };
    }

    // Composite Metric Condition Evaluation
    const cpaExceeded =
      rule.condition.maxAllowedCpaBrl !== undefined &&
      campaign.cpa7dBrl > rule.condition.maxAllowedCpaBrl;

    const roasBelowMinimum =
      rule.condition.minRequiredRoas !== undefined &&
      campaign.roas7d < rule.condition.minRequiredRoas;

    const matched = cpaExceeded || roasBelowMinimum;
    const riskLevel = this.riskEngine.classifyRisk(
      rule.proposedAction.actionType,
      deltaPct
    );

    return {
      matched,
      stageReached: matched ? "APPROVAL" : "ANALYSIS",
      reason: matched
        ? `Condition matched (CPA R$ ${campaign.cpa7dBrl.toFixed(2)} / ROAS ${campaign.roas7d.toFixed(2)}x). Queued for human approval.`
        : "Campaign metrics within healthy thresholds.",
      riskLevel,
      requiresApproval: true,
    };
  }
}

// ============================================================================
// 4. EXECUTION ENGINE (Idempotency, Kill Switch, Read-Only Guard, Circuit Breaker)
// ============================================================================

export class AutomationExecutionError extends Error {
  constructor(
    public readonly code:
      | "KILL_SWITCH_ACTIVE"
      | "READ_ONLY_MODE_ACTIVE"
      | "APPROVAL_REQUIRED"
      | "DUPLICATE_IDEMPOTENCY_KEY"
      | "CIRCUIT_BREAKER_OPEN",
    message: string
  ) {
    super(message);
    this.name = "AutomationExecutionError";
  }
}

export class SupervisedExecutionEngine {
  private readonly executedIdempotencyKeys = new Set<string>();
  private readonly auditTrail: AuditLogEntry[] = [];
  private consecutiveFailures = 0;
  private readonly circuitBreakerThreshold = 3;

  public getAuditTrail(context: TenantContext): AuditLogEntry[] {
    return this.auditTrail.filter(
      (entry) => entry.organizationId === context.organizationId
    );
  }

  public isCircuitOpen(): boolean {
    return this.consecutiveFailures >= this.circuitBreakerThreshold;
  }

  public async executeApprovedMutation(params: {
    context: TenantContext;
    provider: AdvertisingProvider;
    request: CampaignMutationRequest;
    isExplicitlyApproved: boolean;
  }): Promise<MutationExecutionResult> {
    const { context, provider, request, isExplicitlyApproved } = params;

    // 1. Multi-Tenant & RBAC Check
    assertTenantAccess(context, request.organizationId);
    assertPermission(context, "automation:approve_execution");

    // 2. Emergency Kill Switch Check
    if (context.emergencyStopActive) {
      throw new AutomationExecutionError(
        "KILL_SWITCH_ACTIVE",
        "Emergency Kill Switch is active. All automated and supervised executions are suspended."
      );
    }

    // 3. Read-Only Default Mode Check
    const mode: ExecutionMode = context.executionMode;
    if (mode === "READ_ONLY") {
      throw new AutomationExecutionError(
        "READ_ONLY_MODE_ACTIVE",
        "Organization is in READ_ONLY mode. Real campaign mutations are blocked."
      );
    }

    // 4. Explicit Human Approval Check
    if (!isExplicitlyApproved) {
      throw new AutomationExecutionError(
        "APPROVAL_REQUIRED",
        "Explicit human approval is mandatory before executing campaign changes."
      );
    }

    // 5. Circuit Breaker Check
    if (this.isCircuitOpen()) {
      throw new AutomationExecutionError(
        "CIRCUIT_BREAKER_OPEN",
        `Circuit breaker is OPEN after ${this.consecutiveFailures} consecutive provider failures.`
      );
    }

    // 6. Idempotency Guard
    if (this.executedIdempotencyKeys.has(request.idempotencyKey)) {
      throw new AutomationExecutionError(
        "DUPLICATE_IDEMPOTENCY_KEY",
        `Duplicate execution blocked: idempotencyKey '${request.idempotencyKey}' was already processed.`
      );
    }

    try {
      const result = await provider.executeMutation(request);
      this.executedIdempotencyKeys.add(request.idempotencyKey);
      this.consecutiveFailures = 0;

      this.auditTrail.unshift({
        id: `audit-${request.idempotencyKey}`,
        organizationId: context.organizationId,
        timestamp: result.executedAt,
        stage: "AUDIT",
        actor: context.userId,
        action: request.actionType,
        campaignId: request.campaignId,
        details: `Executed & verified via ${provider.providerType} (tx: ${result.externalTransactionId})`,
      });

      return result;
    } catch (error) {
      this.consecutiveFailures += 1;
      throw error;
    }
  }
}
