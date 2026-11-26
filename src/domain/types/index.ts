export type UserRole =
  | "OWNER"
  | "ADMIN"
  | "TRAFFIC_MANAGER"
  | "ANALYST"
  | "CLIENT_VIEWER";

export type ExecutionMode = "READ_ONLY" | "SUPERVISED" | "AUTONOMOUS_LOW_RISK";

export type AdProviderType =
  | "GOOGLE_ADS"
  | "META_ADS"
  | "MICROSOFT_ADS"
  | "MOCK_ADS";

export type CampaignStatus =
  | "ENABLED"
  | "PAUSED"
  | "REMOVED"
  | "LIMITED_BY_BUDGET"
  | "LEARNING";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "EXECUTED";

export type RecommendationLifecycleState =
  | "DRAFT"
  | "VALIDATED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "EXECUTING"
  | "VERIFYING"
  | "EXECUTED_VERIFIED"
  | "FAILED";

export type AutomationStage =
  | "COLLECTION"
  | "NORMALIZATION"
  | "ANALYSIS"
  | "RECOMMENDATION"
  | "VALIDATION"
  | "APPROVAL"
  | "EXECUTION"
  | "VERIFICATION"
  | "AUDIT";

export interface TenantContext {
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly userId: string;
  readonly role: UserRole;
  readonly executionMode: ExecutionMode;
  readonly emergencyStopActive: boolean;
  /**
   * Optional list of client IDs this user is restricted to (mandatory for CLIENT_VIEWER).
   */
  readonly allowedClientIds?: readonly string[];
}
