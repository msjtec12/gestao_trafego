import type {
  ApprovalStatus,
  AutomationStage,
  ExecutionMode,
  RecommendationLifecycleState,
  RiskLevel,
  TenantContext,
  UserRole,
} from "@/domain/types";
import {
  DiscriminatedMutationActionSchema,
  type AdvertisingExecutionProvider,
  type CampaignMutationRequest,
  type CampaignWindowMetrics,
  type MutationExecutionResult,
  type MutationSimulationResult,
  type NormalizedCampaign,
} from "@/integrations/contracts/advertising-provider";
import {
  assertPermission,
  assertTenantAccess,
  hasPermission,
} from "@/security/rbac-and-tenant";

// ============================================================================
// DOMAIN CONTRACTS & PERSISTENCE STORES (DURABLE / INJECTABLE PORTS)
// ============================================================================

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
  readonly evaluatedWindowDays?: number;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly recommendationId: string;
  readonly campaignId: string;
  readonly actionType: CampaignMutationRequest["actionType"];
  readonly status: ApprovalStatus;
  readonly approvedByUserId: string;
  readonly approverRole: UserRole;
  readonly expiresAt: string;
  readonly approvedAt?: string;
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
  readonly previousState?: Record<string, unknown>;
  readonly newState?: Record<string, unknown>;
}

export interface IdempotencyStore {
  tryAcquireLock(organizationId: string, idempotencyKey: string): boolean;
  markCompleted(organizationId: string, idempotencyKey: string): void;
  releaseLockOnFailure(organizationId: string, idempotencyKey: string): void;
  hasProcessedOrInFlight(organizationId: string, idempotencyKey: string): boolean;
}

export interface CircuitBreakerStore {
  getConsecutiveFailures(organizationId: string, providerType: string): number;
  recordFailure(organizationId: string, providerType: string): number;
  reset(organizationId: string, providerType: string): void;
}

export interface KillSwitchStore {
  isGlobalKillSwitchActive(): boolean;
  setGlobalKillSwitch(active: boolean, reason?: string): void;
  isOrganizationKillSwitchActive(organizationId: string): boolean;
  setOrganizationKillSwitch(
    organizationId: string,
    active: boolean,
    reason?: string
  ): void;
}

export interface AuditLogStore {
  append(entry: AuditLogEntry): void;
  listByOrganization(organizationId: string): AuditLogEntry[];
}

// ============================================================================
// DEFAULT IN-MEMORY ADAPTERS FOR FOUNDATION 1.1 & DETERMINISTIC TESTING
// ============================================================================

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly states = new Map<string, "IN_FLIGHT" | "COMPLETED">();

  private compositeKey(organizationId: string, idempotencyKey: string): string {
    return `${organizationId}:${idempotencyKey}`;
  }

  public tryAcquireLock(
    organizationId: string,
    idempotencyKey: string
  ): boolean {
    const key = this.compositeKey(organizationId, idempotencyKey);
    if (this.states.has(key)) {
      return false;
    }
    this.states.set(key, "IN_FLIGHT");
    return true;
  }

  public markCompleted(organizationId: string, idempotencyKey: string): void {
    const key = this.compositeKey(organizationId, idempotencyKey);
    this.states.set(key, "COMPLETED");
  }

  public releaseLockOnFailure(
    organizationId: string,
    idempotencyKey: string
  ): void {
    const key = this.compositeKey(organizationId, idempotencyKey);
    if (this.states.get(key) === "IN_FLIGHT") {
      this.states.delete(key);
    }
  }

  public hasProcessedOrInFlight(
    organizationId: string,
    idempotencyKey: string
  ): boolean {
    return this.states.has(this.compositeKey(organizationId, idempotencyKey));
  }
}

export class InMemoryCircuitBreakerStore implements CircuitBreakerStore {
  private readonly counts = new Map<string, number>();

  private key(organizationId: string, providerType: string): string {
    return `${organizationId}:${providerType}`;
  }

  public getConsecutiveFailures(
    organizationId: string,
    providerType: string
  ): number {
    return this.counts.get(this.key(organizationId, providerType)) ?? 0;
  }

  public recordFailure(organizationId: string, providerType: string): number {
    const k = this.key(organizationId, providerType);
    const next = (this.counts.get(k) ?? 0) + 1;
    this.counts.set(k, next);
    return next;
  }

  public reset(organizationId: string, providerType: string): void {
    this.counts.set(this.key(organizationId, providerType), 0);
  }
}

export class InMemoryKillSwitchStore implements KillSwitchStore {
  private globalActive = process.env.AUTOMATION_GLOBAL_KILL_SWITCH === "true";
  private readonly orgActive = new Map<string, boolean>();

  public isGlobalKillSwitchActive(): boolean {
    return (
      this.globalActive || process.env.AUTOMATION_GLOBAL_KILL_SWITCH === "true"
    );
  }

  public setGlobalKillSwitch(active: boolean): void {
    this.globalActive = active;
  }

  public isOrganizationKillSwitchActive(organizationId: string): boolean {
    return this.orgActive.get(organizationId) ?? false;
  }

  public setOrganizationKillSwitch(
    organizationId: string,
    active: boolean
  ): void {
    this.orgActive.set(organizationId, active);
  }
}

export class InMemoryAuditLogStore implements AuditLogStore {
  private readonly logs: AuditLogEntry[] = [];

  public append(entry: AuditLogEntry): void {
    this.logs.unshift({ ...entry });
  }

  public listByOrganization(organizationId: string): AuditLogEntry[] {
    return this.logs.filter((entry) => entry.organizationId === organizationId);
  }
}

// ============================================================================
// EXPLICIT STATE MACHINE FOR RECOMMENDATION & EXECUTION LIFECYCLE
// ============================================================================

const ALLOWED_STATE_TRANSITIONS: Readonly<
  Record<RecommendationLifecycleState, readonly RecommendationLifecycleState[]>
> = {
  DRAFT: ["VALIDATED", "REJECTED"],
  VALIDATED: ["PENDING_APPROVAL", "REJECTED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED"],
  APPROVED: ["EXECUTING", "EXPIRED"],
  REJECTED: [],
  EXPIRED: [],
  EXECUTING: ["VERIFYING", "FAILED"],
  VERIFYING: ["EXECUTED_VERIFIED", "FAILED"],
  EXECUTED_VERIFIED: [],
  FAILED: [],
};

export class RecommendationStateMachine {
  public static canTransition(
    from: RecommendationLifecycleState,
    to: RecommendationLifecycleState
  ): boolean {
    const allowed = ALLOWED_STATE_TRANSITIONS[from];
    return Array.isArray(allowed) && allowed.includes(to);
  }

  public static transition(
    from: RecommendationLifecycleState,
    to: RecommendationLifecycleState
  ): RecommendationLifecycleState {
    if (!this.canTransition(from, to)) {
      throw new Error(
        `Invalid RecommendationLifecycleState transition from '${from}' to '${to}'.`
      );
    }
    return to;
  }
}

// ============================================================================
// ENGINE 1: POLICY ENGINE & RESTRICTED CONTENT / FINANCIAL BLOCKER
// ============================================================================

const RESTRICTED_PRODUCT_KEYWORDS = [
  "cassino ilegal",
  "apostas sem licenca",
  "armas de fogo",
  "documentos falsos",
  "cura milagrosa garantida",
  "substancias ilicitas",
];

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
    organizationMaxPct: number,
    currentDailyBudgetBrl?: number
  ): { allowed: boolean; violationReason?: string } {
    if (
      !Number.isFinite(requestedChangePct) ||
      !Number.isFinite(organizationMaxPct) ||
      organizationMaxPct <= 0 ||
      organizationMaxPct > 100
    ) {
      return {
        allowed: false,
        violationReason:
          "Invalid financial parameters: percentage values must be finite numbers and organizationMaxPct must be within (0, 100].",
      };
    }

    if (
      currentDailyBudgetBrl !== undefined &&
      (!Number.isFinite(currentDailyBudgetBrl) || currentDailyBudgetBrl <= 0)
    ) {
      return {
        allowed: false,
        violationReason:
          "Invalid currentDailyBudgetBrl: campaign budget must be a finite positive amount.",
      };
    }

    if (requestedChangePct <= -100) {
      return {
        allowed: false,
        violationReason:
          "Budget reduction cannot be -100% or lower (use PAUSE_CAMPAIGN instead).",
      };
    }

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
// ENGINE 2: RISK ENGINE
// ============================================================================

export class RiskEngine {
  public classifyRisk(
    actionType: CampaignMutationRequest["actionType"],
    budgetDeltaPct = 0
  ): RiskLevel {
    if (!Number.isFinite(budgetDeltaPct)) {
      return "CRITICAL";
    }
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
// ENGINE 3: RULE ENGINE (Enabled Check, Dynamic Time Windows, Minimum Data, Cooldown)
// ============================================================================

export class RuleEngine {
  private readonly policyEngine = new PolicyEngine();
  private readonly riskEngine = new RiskEngine();

  private resolveMetricsForWindow(
    campaign: NormalizedCampaign,
    timeWindowDays: number
  ): CampaignWindowMetrics | null {
    if (!Number.isInteger(timeWindowDays) || timeWindowDays <= 0) {
      return null;
    }
    if (campaign.metricsByWindowDays?.[timeWindowDays]) {
      return campaign.metricsByWindowDays[timeWindowDays]!;
    }
    if (timeWindowDays === 7) {
      return {
        windowDays: 7,
        spendBrl: campaign.spend7dBrl,
        conversions: campaign.conversions7d,
        cpaBrl: campaign.cpa7dBrl,
        roas: campaign.roas7d,
        ctrPct: campaign.ctr7dPct,
        impressions: campaign.impressions7d,
        clicks: campaign.clicks7d,
      };
    }
    return null;
  }

  public evaluateCampaign(
    context: TenantContext,
    rule: AutomationRuleDefinition,
    campaign: NormalizedCampaign,
    now: Date = new Date()
  ): RuleEvaluationOutput {
    assertTenantAccess(context, rule.organizationId);
    assertTenantAccess(context, campaign.organizationId);

    // 1. Disabled Rule Guard (Phase D Fix #1)
    if (!rule.isEnabled) {
      return {
        matched: false,
        stageReached: "COLLECTION",
        reason: `Rule '${rule.name}' is disabled (isEnabled: false) and was skipped.`,
        riskLevel: "LOW",
        requiresApproval: true,
      };
    }

    // 2. Content Policy Guard
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

    // 3. Financial Limit Guardrail (checked early before metric matching)
    const deltaPct = rule.proposedAction.budgetDeltaPct ?? 0;
    const financialPolicy = this.policyEngine.validateFinancialLimit(
      deltaPct,
      rule.maxBudgetChangePct,
      campaign.dailyBudgetBrl
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

    // 4. Dynamic Time Window Resolution (Phase D Fix #2)
    const windowMetrics = this.resolveMetricsForWindow(
      campaign,
      rule.timeWindowDays
    );
    if (!windowMetrics) {
      return {
        matched: false,
        stageReached: "NORMALIZATION",
        reason: `Metrics for requested timeWindowDays (${rule.timeWindowDays}d) are unavailable for campaign '${campaign.id}'.`,
        riskLevel: "LOW",
        requiresApproval: true,
        evaluatedWindowDays: rule.timeWindowDays,
      };
    }

    // 5. Minimum Statistical Data Guardrails
    if (
      windowMetrics.impressions < rule.minImpressions ||
      windowMetrics.clicks < rule.minClicks ||
      windowMetrics.spendBrl < rule.minSpendBrl
    ) {
      return {
        matched: false,
        stageReached: "ANALYSIS",
        reason: `Insufficient statistical sample in ${rule.timeWindowDays}d window (min ${rule.minImpressions} impr, ${rule.minClicks} clicks, R$ ${rule.minSpendBrl} spend).`,
        riskLevel: "LOW",
        requiresApproval: true,
        evaluatedWindowDays: rule.timeWindowDays,
      };
    }

    // 6. Cooldown Guardrail
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
          evaluatedWindowDays: rule.timeWindowDays,
        };
      }
    }

    // 7. Composite Metric Condition Evaluation over the configured window
    const cpaExceeded =
      rule.condition.maxAllowedCpaBrl !== undefined &&
      windowMetrics.cpaBrl > rule.condition.maxAllowedCpaBrl;

    const roasBelowMinimum =
      rule.condition.minRequiredRoas !== undefined &&
      windowMetrics.roas < rule.condition.minRequiredRoas;

    const matched = cpaExceeded || roasBelowMinimum;
    const riskLevel = this.riskEngine.classifyRisk(
      rule.proposedAction.actionType,
      deltaPct
    );

    return {
      matched,
      stageReached: matched ? "APPROVAL" : "ANALYSIS",
      reason: matched
        ? `Condition matched in ${rule.timeWindowDays}d window (CPA R$ ${windowMetrics.cpaBrl.toFixed(2)} / ROAS ${windowMetrics.roas.toFixed(2)}x). Queued for human approval.`
        : "Campaign metrics within healthy thresholds.",
      riskLevel,
      requiresApproval: true,
      evaluatedWindowDays: rule.timeWindowDays,
    };
  }
}

// ============================================================================
// ENGINE 4: SIMULATION ENGINE
// ============================================================================

export class SimulationEngine {
  public async simulate(
    context: TenantContext,
    provider: AdvertisingExecutionProvider,
    request: CampaignMutationRequest
  ): Promise<MutationSimulationResult> {
    assertTenantAccess(context, request.organizationId);
    return await provider.simulateMutation(request);
  }
}

// ============================================================================
// ENGINE 5: APPROVAL ENGINE (Structured Approval Validation)
// ============================================================================

export class ApprovalEngine {
  public validateApproval(
    context: TenantContext,
    request: CampaignMutationRequest,
    approval?: ApprovalRecord | null,
    now: Date = new Date()
  ): { valid: boolean; reason?: string } {
    if (!approval) {
      return {
        valid: false,
        reason: "Missing ApprovalRecord: explicit human approval is required.",
      };
    }

    if (approval.organizationId !== context.organizationId) {
      return {
        valid: false,
        reason: "ApprovalRecord organizationId does not match session tenant.",
      };
    }

    if (approval.status !== "APPROVED") {
      return {
        valid: false,
        reason: `ApprovalRecord status is '${approval.status}' (must be 'APPROVED').`,
      };
    }

    if (approval.campaignId !== request.campaignId) {
      return {
        valid: false,
        reason: `ApprovalRecord campaignId (${approval.campaignId}) does not match request campaignId (${request.campaignId}).`,
      };
    }

    if (approval.actionType !== request.actionType) {
      return {
        valid: false,
        reason: `ApprovalRecord actionType (${approval.actionType}) does not match request actionType (${request.actionType}).`,
      };
    }

    if (
      !hasPermission(approval.approverRole, "automation:approve_execution")
    ) {
      return {
        valid: false,
        reason: `Approver role '${approval.approverRole}' is not authorized to approve campaign executions.`,
      };
    }

    const expiresMs = Date.parse(approval.expiresAt);
    if (Number.isNaN(expiresMs) || expiresMs <= now.getTime()) {
      return {
        valid: false,
        reason: `ApprovalRecord '${approval.id}' has expired at '${approval.expiresAt}'.`,
      };
    }

    return { valid: true };
  }
}

// ============================================================================
// ENGINE 6: AUDIT ENGINE
// ============================================================================

export class AuditEngine {
  constructor(
    private readonly store: AuditLogStore = new InMemoryAuditLogStore()
  ) {}

  public record(entry: AuditLogEntry): void {
    this.store.append(entry);
  }

  public listTrail(context: TenantContext): AuditLogEntry[] {
    return this.store.listByOrganization(context.organizationId);
  }
}

// ============================================================================
// ENGINE 7: EXECUTION ENGINE (Idempotency, Kill Switch, Verification, Circuit Breaker)
// ============================================================================

export class AutomationExecutionError extends Error {
  constructor(
    public readonly code:
      | "KILL_SWITCH_ACTIVE"
      | "GLOBAL_KILL_SWITCH_ACTIVE"
      | "READ_ONLY_MODE_ACTIVE"
      | "APPROVAL_REQUIRED"
      | "INVALID_APPROVAL_RECORD"
      | "DUPLICATE_IDEMPOTENCY_KEY"
      | "CIRCUIT_BREAKER_OPEN"
      | "NON_SIMULATED_PROVIDER_BLOCKED"
      | "INVALID_MUTATION_PAYLOAD"
      | "POST_EXECUTION_VERIFICATION_FAILED",
    message: string
  ) {
    super(message);
    this.name = "AutomationExecutionError";
  }
}

export interface ExecutionEngineDependencies {
  readonly idempotencyStore?: IdempotencyStore;
  readonly circuitBreakerStore?: CircuitBreakerStore;
  readonly killSwitchStore?: KillSwitchStore;
  readonly auditEngine?: AuditEngine;
  readonly approvalEngine?: ApprovalEngine;
  readonly circuitBreakerThreshold?: number;
}

export class SupervisedExecutionEngine {
  private readonly idempotencyStore: IdempotencyStore;
  private readonly circuitBreakerStore: CircuitBreakerStore;
  private readonly killSwitchStore: KillSwitchStore;
  private readonly auditEngine: AuditEngine;
  private readonly approvalEngine: ApprovalEngine;
  private readonly circuitBreakerThreshold: number;
  private lastKnownContext: { orgId: string; provider: string } | null = null;

  constructor(deps: ExecutionEngineDependencies = {}) {
    this.idempotencyStore =
      deps.idempotencyStore ?? new InMemoryIdempotencyStore();
    this.circuitBreakerStore =
      deps.circuitBreakerStore ?? new InMemoryCircuitBreakerStore();
    this.killSwitchStore =
      deps.killSwitchStore ?? new InMemoryKillSwitchStore();
    this.auditEngine = deps.auditEngine ?? new AuditEngine();
    this.approvalEngine = deps.approvalEngine ?? new ApprovalEngine();
    this.circuitBreakerThreshold = deps.circuitBreakerThreshold ?? 3;
  }

  public getAuditTrail(context: TenantContext): AuditLogEntry[] {
    return this.auditEngine.listTrail(context);
  }

  public getKillSwitchStore(): KillSwitchStore {
    return this.killSwitchStore;
  }

  public isCircuitOpen(
    organizationId?: string,
    providerType = "MOCK_ADS"
  ): boolean {
    const orgId = organizationId ?? this.lastKnownContext?.orgId ?? "";
    const prov = this.lastKnownContext?.provider ?? providerType;
    return (
      this.circuitBreakerStore.getConsecutiveFailures(orgId, prov) >=
      this.circuitBreakerThreshold
    );
  }

  private validatePayloadIfStructured(request: CampaignMutationRequest): void {
    const payloadKeys = Object.keys(request.payload);
    if (payloadKeys.length === 0) {
      return;
    }

    if (
      request.actionType === "ADJUST_DAILY_BUDGET" &&
      "proposedDailyBudgetBrl" in request.payload
    ) {
      const parsed = DiscriminatedMutationActionSchema.safeParse({
        actionType: request.actionType,
        payload: request.payload,
      });
      if (!parsed.success) {
        throw new AutomationExecutionError(
          "INVALID_MUTATION_PAYLOAD",
          `Invalid mutation payload for ${request.actionType}: ${parsed.error.message}`
        );
      }
    }
  }

  public async executeApprovedMutation(params: {
    context: TenantContext;
    provider: AdvertisingExecutionProvider;
    request: CampaignMutationRequest;
    isExplicitlyApproved?: boolean;
    approval?: ApprovalRecord;
    now?: Date;
  }): Promise<MutationExecutionResult> {
    const {
      context,
      provider,
      request,
      isExplicitlyApproved,
      approval,
      now = new Date(),
    } = params;

    this.lastKnownContext = {
      orgId: context.organizationId,
      provider: provider.providerType,
    };

    // 1. Multi-Tenant & RBAC Check
    assertTenantAccess(context, request.organizationId);
    assertPermission(context, "automation:approve_execution");

    // 2. Foundation 1.1 Safety Gate: Block real non-simulated providers
    if (!provider.isSimulated) {
      throw new AutomationExecutionError(
        "NON_SIMULATED_PROVIDER_BLOCKED",
        `Provider '${provider.providerType}' is not simulated. Real ad platform execution is strictly blocked in Foundation 1.1.`
      );
    }

    // 3. Global & Per-Organization Emergency Kill Switch Check
    if (this.killSwitchStore.isGlobalKillSwitchActive()) {
      throw new AutomationExecutionError(
        "GLOBAL_KILL_SWITCH_ACTIVE",
        "Global Emergency Kill Switch is active. All automated and supervised executions are suspended platform-wide."
      );
    }

    if (
      context.emergencyStopActive ||
      this.killSwitchStore.isOrganizationKillSwitchActive(context.organizationId)
    ) {
      throw new AutomationExecutionError(
        "KILL_SWITCH_ACTIVE",
        "Emergency Kill Switch is active. All automated and supervised executions are suspended."
      );
    }

    // 4. Read-Only Default Mode Check
    const mode: ExecutionMode = context.executionMode;
    if (mode === "READ_ONLY") {
      throw new AutomationExecutionError(
        "READ_ONLY_MODE_ACTIVE",
        "Organization is in READ_ONLY mode. Real campaign mutations are blocked."
      );
    }

    // 5. Structured Approval Engine Validation
    if (approval !== undefined) {
      const approvalCheck = this.approvalEngine.validateApproval(
        context,
        request,
        approval,
        now
      );
      if (!approvalCheck.valid) {
        throw new AutomationExecutionError(
          "INVALID_APPROVAL_RECORD",
          approvalCheck.reason ?? "Invalid approval record."
        );
      }
    } else if (!isExplicitlyApproved) {
      throw new AutomationExecutionError(
        "APPROVAL_REQUIRED",
        "Explicit human approval is mandatory before executing campaign changes."
      );
    }

    // 6. Validate Payload Financial Integrity
    this.validatePayloadIfStructured(request);

    // 7. Circuit Breaker Check
    if (this.isCircuitOpen(context.organizationId, provider.providerType)) {
      const failures = this.circuitBreakerStore.getConsecutiveFailures(
        context.organizationId,
        provider.providerType
      );
      throw new AutomationExecutionError(
        "CIRCUIT_BREAKER_OPEN",
        `Circuit breaker is OPEN after ${failures} consecutive provider failures.`
      );
    }

    // 8. Concurrent-Safe Idempotency Guard (IN_FLIGHT + COMPLETED lock)
    const lockAcquired = this.idempotencyStore.tryAcquireLock(
      context.organizationId,
      request.idempotencyKey
    );
    if (!lockAcquired) {
      throw new AutomationExecutionError(
        "DUPLICATE_IDEMPOTENCY_KEY",
        `Duplicate execution blocked: idempotencyKey '${request.idempotencyKey}' was already processed or is currently in-flight.`
      );
    }

    let lifecycleState: RecommendationLifecycleState =
      RecommendationStateMachine.transition("APPROVED", "EXECUTING");

    try {
      const result = await provider.executeMutation(request);

      lifecycleState = RecommendationStateMachine.transition(
        lifecycleState,
        "VERIFYING"
      );

      // 9. Independent Post-Execution Verification (Phase D Fix #8)
      if (provider.verifyMutation) {
        const verification = await provider.verifyMutation(request, result);
        if (!verification.verified) {
          RecommendationStateMachine.transition(lifecycleState, "FAILED");
          throw new AutomationExecutionError(
            "POST_EXECUTION_VERIFICATION_FAILED",
            verification.discrepancyReason ??
              "Independent post-execution verification failed."
          );
        }
      }

      lifecycleState = RecommendationStateMachine.transition(
        lifecycleState,
        "EXECUTED_VERIFIED"
      );

      this.idempotencyStore.markCompleted(
        context.organizationId,
        request.idempotencyKey
      );
      this.circuitBreakerStore.reset(
        context.organizationId,
        provider.providerType
      );

      this.auditEngine.record({
        id: `audit-${request.idempotencyKey}`,
        organizationId: context.organizationId,
        timestamp: result.executedAt,
        stage: "AUDIT",
        actor: approval?.approvedByUserId ?? context.userId,
        action: request.actionType,
        campaignId: request.campaignId,
        details: `State ${lifecycleState}: Executed & verified via ${provider.providerType} (tx: ${result.externalTransactionId})`,
        newState: result.verifiedState,
      });

      return result;
    } catch (error) {
      this.idempotencyStore.releaseLockOnFailure(
        context.organizationId,
        request.idempotencyKey
      );
      this.circuitBreakerStore.recordFailure(
        context.organizationId,
        provider.providerType
      );
      throw error;
    }
  }
}

export { SupervisedExecutionEngine as ExecutionEngine };
