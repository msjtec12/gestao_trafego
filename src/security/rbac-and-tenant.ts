import type { TenantContext, UserRole } from "@/domain/types";

export class TenantIsolationError extends Error {
  public readonly code = "TENANT_ISOLATION_VIOLATION";
  public readonly statusCode = 403;

  constructor(
    public readonly sessionOrganizationId: string,
    public readonly targetOrganizationId: string,
    customMessage?: string
  ) {
    super(
      customMessage ??
        `Cross-tenant access denied: session organization (${sessionOrganizationId}) cannot access resource belonging to (${targetOrganizationId}).`
    );
    this.name = "TenantIsolationError";
  }
}

export class PermissionDeniedError extends Error {
  public readonly code = "RBAC_PERMISSION_DENIED";
  public readonly statusCode = 403;

  constructor(
    public readonly role: string,
    public readonly permission: string,
    customMessage?: string
  ) {
    super(
      customMessage ??
        `Role '${role}' is not authorized to perform '${permission}'.`
    );
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

const VALID_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  "OWNER",
  "ADMIN",
  "TRAFFIC_MANAGER",
  "ANALYST",
  "CLIENT_VIEWER",
]);

const VALID_PERMISSIONS: ReadonlySet<PermissionAction> =
  new Set<PermissionAction>([
    "dashboard:view",
    "ai:analyze",
    "automation:manage_rules",
    "automation:approve_execution",
    "automation:trigger_kill_switch",
    "integrations:manage",
    "organization:manage_billing",
  ]);

/**
 * Aligned strictly with docs/security.md RBAC matrix:
 * OWNER & ADMIN hold all governance, integration, and billing capabilities.
 */
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
    "organization:manage_billing",
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
  const sessionOrg = context?.organizationId?.trim() ?? "";
  const targetOrg = resourceOrganizationId?.trim() ?? "";

  if (!sessionOrg || !targetOrg || sessionOrg !== targetOrg) {
    throw new TenantIsolationError(
      sessionOrg || "UNKNOWN",
      targetOrg || "UNKNOWN"
    );
  }
}

/**
 * Enforces client-level authorization.
 * - CLIENT_VIEWER MUST have an explicit non-empty allowedClientIds list containing targetClientId.
 * - Other roles with an optional allowedClientIds restriction are also checked fail-closed.
 */
export function assertClientScopeAccess(
  context: TenantContext,
  targetClientId: string
): void {
  if (!targetClientId || targetClientId.trim() === "") {
    throw new PermissionDeniedError(
      context.role,
      "dashboard:view",
      "Client-scoped access check failed: targetClientId is empty."
    );
  }

  if (context.role === "CLIENT_VIEWER") {
    const allowed = context.allowedClientIds;
    if (!allowed || allowed.length === 0 || !allowed.includes(targetClientId)) {
      throw new PermissionDeniedError(
        context.role,
        "dashboard:view",
        `CLIENT_VIEWER (${context.userId}) is not authorized to access client '${targetClientId}'.`
      );
    }
    return;
  }

  if (
    context.allowedClientIds &&
    context.allowedClientIds.length > 0 &&
    !context.allowedClientIds.includes(targetClientId)
  ) {
    throw new PermissionDeniedError(
      context.role,
      "dashboard:view",
      `User (${context.userId}) is restricted from accessing client '${targetClientId}'.`
    );
  }
}

export function filterTenantRecords<
  T extends { organizationId: string; clientId?: string }
>(context: TenantContext, records: readonly T[]): T[] {
  if (!context?.organizationId) {
    return [];
  }
  return records.filter((record) => {
    if (record.organizationId !== context.organizationId) {
      return false;
    }
    if (context.role === "CLIENT_VIEWER") {
      if (!record.clientId || !context.allowedClientIds) {
        return false;
      }
      return context.allowedClientIds.includes(record.clientId);
    }
    if (
      record.clientId &&
      context.allowedClientIds &&
      context.allowedClientIds.length > 0
    ) {
      return context.allowedClientIds.includes(record.clientId);
    }
    return true;
  });
}

/**
 * Fail-closed permission evaluation: unknown roles or unknown permission names return false.
 */
export function hasPermission(
  role: UserRole,
  permission: PermissionAction
): boolean {
  if (!VALID_ROLES.has(role) || !VALID_PERMISSIONS.has(permission)) {
    return false;
  }
  const allowed = ROLE_PERMISSIONS[role];
  return Array.isArray(allowed) && allowed.includes(permission);
}

export function assertPermission(
  context: TenantContext,
  permission: PermissionAction
): void {
  if (!context || !hasPermission(context.role, permission)) {
    throw new PermissionDeniedError(
      context?.role ?? "UNKNOWN_ROLE",
      permission
    );
  }
}
