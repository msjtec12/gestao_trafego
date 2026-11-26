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
}
