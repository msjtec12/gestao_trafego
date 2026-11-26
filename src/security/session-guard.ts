import { z } from "zod";
import type { ExecutionMode, TenantContext, UserRole } from "@/domain/types";
import {
  PermissionDeniedError,
  TenantIsolationError,
} from "./rbac-and-tenant";

export class UnauthenticatedAccessError extends Error {
  public readonly code = "UNAUTHENTICATED_ACCESS";
  public readonly statusCode = 401;

  constructor(message = "Authentication required: invalid or expired session.") {
    super(message);
    this.name = "UnauthenticatedAccessError";
  }
}

export interface ServerSessionToken {
  readonly sessionId: string;
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

export interface ServerMembershipRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly organizationName: string;
  readonly userId: string;
  readonly role: UserRole;
  readonly executionMode: ExecutionMode;
  readonly emergencyStopActive: boolean;
  readonly allowedClientIds?: readonly string[];
}

/**
 * Validates a server-side session and resolves the authoritative TenantContext
 * exclusively from server-side membership records.
 *
 * CRITICAL SECURITY INVARIANT (Phase 2):
 * Browser/client-supplied `organizationId`, `userId`, or `role` in payloads are NEVER
 * trusted to grant access; the server resolves the user's membership for the requested
 * organizationId directly from the authoritative membership store.
 */
export function resolveAuthoritativeTenantContext(params: {
  readonly session: ServerSessionToken | null | undefined;
  readonly requestedOrganizationId: string;
  readonly serverMemberships: readonly ServerMembershipRecord[];
  readonly untrustedClientClaims?: {
    readonly userId?: string;
    readonly role?: UserRole;
    readonly organizationId?: string;
  };
  readonly nowMs?: number;
}): TenantContext {
  const {
    session,
    requestedOrganizationId,
    serverMemberships,
    untrustedClientClaims,
    nowMs = Date.now(),
  } = params;

  if (!session || !session.userId || !session.sessionId) {
    throw new UnauthenticatedAccessError(
      "Missing or invalid authentication session."
    );
  }

  if (
    !Number.isFinite(session.expiresAtMs) ||
    session.expiresAtMs <= nowMs
  ) {
    throw new UnauthenticatedAccessError(
      `Session '${session.sessionId}' has expired.`
    );
  }

  // Detect and reject if client payload attempts to spoof another userId
  if (
    untrustedClientClaims?.userId &&
    untrustedClientClaims.userId !== session.userId
  ) {
    throw new PermissionDeniedError(
      "SPOOFED_USER",
      "dashboard:view",
      "Client-supplied userId does not match authenticated server session."
    );
  }

  const targetOrgId = requestedOrganizationId?.trim();
  if (!targetOrgId) {
    throw new TenantIsolationError(
      "NONE",
      "EMPTY",
      "Target organizationId is required."
    );
  }

  // Look up membership strictly by authenticated session.userId + targetOrgId
  const membership = serverMemberships.find(
    (m) =>
      m.userId === session.userId && m.organizationId === targetOrgId
  );

  if (!membership) {
    throw new TenantIsolationError(
      session.userId,
      targetOrgId,
      `Authenticated user '${session.userId}' has no membership in organization '${targetOrgId}'.`
    );
  }

  // Note: Any untrustedClientClaims.role is completely ignored in favor of membership.role
  return {
    organizationId: membership.organizationId,
    organizationSlug: membership.organizationSlug,
    userId: session.userId,
    role: membership.role,
    executionMode: membership.executionMode,
    emergencyStopActive: membership.emergencyStopActive,
    allowedClientIds: membership.allowedClientIds,
  };
}

export const OnboardingInputSchema = z.object({
  fullName: z.string().min(3).max(160),
  email: z.string().email().max(255),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(128),
  organizationName: z.string().min(3).max(160),
  organizationSlug: z
    .string()
    .min(3)
    .max(100)
    .regex(
      /^[a-z0-9-]+$/,
      "Organization slug must contain only lowercase letters, numbers, and hyphens"
    ),
  timezone: z.string().min(3).default("America/Sao_Paulo"),
  currencyCode: z.string().length(3).default("BRL"),
});

export type OnboardingInput = z.infer<typeof OnboardingInputSchema>;
