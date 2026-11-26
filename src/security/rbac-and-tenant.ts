import type { TenantContext, UserRole } from "@/domain/types";

export class TenantIsolationError extends Error {
  public readonly code = "TENANT_ISOLATION_VIOLATION";
  public readonly statusCode = 403;

  constructor(
    public readonly sessionOrganizationId: string,
    public readonly targetOrganizationId: string
  ) {
    super(
      `Cross-tenant access denied: session organization (${sessionOrganizationId}) cannot access resource belonging to (${targetOrganizationId}).`
    );
    this.name = "TenantIsolationError";
  }
}

export class PermissionDeniedError extends Error {
  public readonly code = "RBAC_PERMISSION_DENIED";
  public readonly statusCode = 403;

  constructor(
    public readonly role: UserRole,
    public readonly permission: PermissionAction
  ) {
    super(`Role '${role}' is not authorized to perform '${permission}'.`);
    this.name = "PermissionDeniedError";
  }
}

export type PermissionAction =
  | "dashboard:view"
  | "ai:analyze"
  | "automation:manage_rules"
  | "automation:approve_execution"
  | "automation:trigger_kill_switch"
  | "integrations:manage"
  | "organization:manage_billing";

const ROLE_PERMISSIONS: Record<UserRole, readonly PermissionAction[]> = {
  OWNER: [
    "dashboard:view",
    "ai:analyze",
    "automation:manage_rules",
    "automation:approve_execution",
    "automation:trigger_kill_switch",
    "integrations:manage",
    "organization:manage_billing",
  ],
  ADMIN: [
    "dashboard:view",
    "ai:analyze",
    "automation:manage_rules",
    "automation:approve_execution",
    "automation:trigger_kill_switch",
    "integrations:manage",
  ],
  TRAFFIC_MANAGER: [
    "dashboard:view",
    "ai:analyze",
    "automation:manage_rules",
    "automation:approve_execution",
    "automation:trigger_kill_switch",
  ],
  ANALYST: ["dashboard:view", "ai:analyze"],
  CLIENT_VIEWER: ["dashboard:view"],
};

export function assertTenantAccess(
  context: TenantContext,
  resourceOrganizationId: string
): void {
  if (
    !context.organizationId ||
    !resourceOrganizationId ||
    context.organizationId !== resourceOrganizationId
  ) {
    throw new TenantIsolationError(
      context.organizationId || "UNKNOWN",
      resourceOrganizationId || "UNKNOWN"
    );
  }
}

export function filterTenantRecords<T extends { organizationId: string }>(
  context: TenantContext,
  records: readonly T[]
): T[] {
  return records.filter(
    (record) => record.organizationId === context.organizationId
  );
}

export function hasPermission(
  role: UserRole,
  permission: PermissionAction
): boolean {
  const allowed = ROLE_PERMISSIONS[role];
  return allowed.includes(permission);
}

export function assertPermission(
  context: TenantContext,
  permission: PermissionAction
): void {
  if (!hasPermission(context.role, permission)) {
    throw new PermissionDeniedError(context.role, permission);
  }
}
