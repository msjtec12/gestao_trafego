import crypto from "crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { TenantContext, UserRole } from "@/domain/types";
import {
  assertAuthenticatedDbContext,
  type DrizzleQueryExecutor,
} from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";
import {
  assertClientScopeAccess,
  assertPermission,
  assertTenantAccess,
  TenantIsolationError,
} from "@/security/rbac-and-tenant";
import {
  hashPasswordScrypt,
  PersistentPostgresAuthRateLimiter,
  verifyPasswordScrypt,
} from "@/security/auth-rate-limiter";
import {
  OnboardingInputSchema,
  UnauthenticatedAccessError,
  type OnboardingInput,
} from "@/security/session-guard";

export interface AuthenticatedPostgresSession {
  readonly sessionToken: string;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly fullName: string;
  };
  readonly context: TenantContext;
  readonly availableOrganizations: readonly {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly role: UserRole;
  }[];
}

export interface AggregatedPeriodMetricsResult {
  readonly hasData: boolean;
  readonly periodDays: number;
  readonly campaignCount: number;
  readonly totalSpendCents: number;
  readonly totalSpendBrl: number;
  readonly totalImpressions: number;
  readonly totalClicks: number;
  readonly totalConversions: number;
  readonly totalConversionValueCents: number;
  readonly totalAllocatedBudgetCents: number;
  /**
   * Aggregated rates computed strictly from total sums (NEVER average of campaign rates).
   * Null when denominator is 0.
   */
  readonly ctrPct: number | null;
  readonly cpcCents: number | null;
  readonly cpcBrl: number | null;
  readonly cpaCents: number | null;
  readonly cpaBrl: number | null;
  readonly roas: number | null;
  readonly timeline: readonly {
    readonly date: string;
    readonly label: string;
    readonly spendBrl: number;
    readonly conversions: number;
    readonly clicks: number;
    readonly impressions: number;
    readonly cpaBrl: number;
    readonly roas: number;
    readonly isDemoData: boolean;
  }[];
}

/**
 * Executes secure onboarding of a user, creating their first organization in READ_ONLY mode,
 * OWNER membership, persistent user_session, and audit log entry.
 */
export async function onboardFirstOrganizationRepository(
  tx: DrizzleQueryExecutor,
  rawInput: OnboardingInput,
  options?: { readonly nowMs?: number }
): Promise<{
  readonly user: typeof schema.users.$inferSelect;
  readonly organization: typeof schema.organizations.$inferSelect;
  readonly membership: typeof schema.memberships.$inferSelect;
  readonly sessionToken: string;
}> {
  const input = OnboardingInputSchema.parse(rawInput);
  const nowMs = options?.nowMs ?? Date.now();
  const normalizedEmail = input.email.toLowerCase().trim();
  const normalizedSlug = input.organizationSlug.trim().toLowerCase();

  const existingUsers: (typeof schema.users.$inferSelect)[] = await tx
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, normalizedEmail));

  if (existingUsers.length > 0) {
    throw new Error("Este e-mail já está cadastrado. Realize o login.");
  }

  const existingOrgs: (typeof schema.organizations.$inferSelect)[] = await tx
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, normalizedSlug));

  if (existingOrgs.length > 0) {
    throw new Error(
      "Este identificador (slug) de organização já está em uso."
    );
  }

  const passwordHash = hashPasswordScrypt(input.password);

  const [createdUser] = await tx
    .insert(schema.users)
    .values({
      email: normalizedEmail,
      fullName: input.fullName.trim(),
      passwordHash,
      isActive: true,
      lgpdConsentAt: new Date(nowMs),
    })
    .returning();

  const [createdOrg] = await tx
    .insert(schema.organizations)
    .values({
      name: input.organizationName.trim(),
      slug: normalizedSlug,
      executionMode: "READ_ONLY",
      emergencyStopActive: false,
      timezone: input.timezone,
      currencyCode: input.currencyCode,
    })
    .returning();

  if (!createdUser || !createdOrg) {
    throw new Error("Falha ao criar usuário ou organização no PostgreSQL.");
  }

  const [createdMembership] = await tx
    .insert(schema.memberships)
    .values({
      organizationId: createdOrg.id,
      userId: createdUser.id,
      role: "OWNER",
    })
    .returning();

  if (!createdMembership) {
    throw new Error("Falha ao criar membership OWNER no PostgreSQL.");
  }

  const sessionToken = `ksess_${crypto.randomBytes(32).toString("hex")}`;
  await tx.insert(schema.userSessions).values({
    sessionToken,
    userId: createdUser.id,
    activeOrganizationId: createdOrg.id,
    expiresAt: new Date(nowMs + 8 * 60 * 60 * 1000),
  });

  await tx.insert(schema.auditLogs).values({
    organizationId: createdOrg.id,
    actorUserId: createdUser.id,
    actorType: "USER",
    action: "ORGANIZATION_ONBOARDED",
    entityType: "organization",
    entityId: createdOrg.id,
    newState: {
      slug: createdOrg.slug,
      executionMode: createdOrg.executionMode,
      ownerUserId: createdUser.id,
    },
  });

  return {
    user: createdUser,
    organization: createdOrg,
    membership: createdMembership,
    sessionToken,
  };
}

/**
 * Authenticates a user directly against the PostgreSQL `users` and `memberships` tables,
 * enforcing durable rate limiting (`auth_rate_limits`), creating a persistent session in
 * `user_sessions`, and recording audit events in `audit_logs`.
 */
export async function authenticateUserWithPostgres(
  db: DrizzleQueryExecutor,
  params: {
    readonly email: string;
    readonly password: string;
    readonly nowMs?: number;
    readonly sessionTtlMs?: number;
  }
): Promise<AuthenticatedPostgresSession> {
  const nowMs = params.nowMs ?? Date.now();
  const sessionTtlMs = params.sessionTtlMs ?? 8 * 60 * 60 * 1000;
  const normalizedEmail = params.email.trim().toLowerCase();

  const rateLimiter = new PersistentPostgresAuthRateLimiter(db);
  const rateCheck = await rateLimiter.checkAllowed(normalizedEmail, nowMs);
  if (!rateCheck.allowed) {
    throw new UnauthenticatedAccessError(
      `Muitas tentativas de login. Aguarde ${rateCheck.retryAfterSeconds}s antes de tentar novamente.`
    );
  }

  const usersFound: (typeof schema.users.$inferSelect)[] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, normalizedEmail));

  const user = usersFound[0];
  if (
    !user ||
    !user.isActive ||
    !user.passwordHash ||
    !verifyPasswordScrypt(params.password, user.passwordHash)
  ) {
    await rateLimiter.recordFailedAttempt(normalizedEmail, nowMs);

    // If user belongs to an organization, record failed login attempt in audit_logs
    if (user) {
      const userMems: (typeof schema.memberships.$inferSelect)[] = await db
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.userId, user.id));
      if (userMems[0]) {
        await db.insert(schema.auditLogs).values({
          organizationId: userMems[0].organizationId,
          actorUserId: user.id,
          actorType: "USER",
          action: "AUTH_LOGIN_FAILED",
          entityType: "user",
          entityId: user.id,
          newState: { result: "INVALID_CREDENTIALS" },
        });
      }
    }

    throw new UnauthenticatedAccessError("E-mail ou senha inválidos.");
  }

  await rateLimiter.reset(normalizedEmail);

  const userMemberships: (typeof schema.memberships.$inferSelect)[] = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, user.id));

  const primaryMembership = userMemberships[0];
  if (!primaryMembership) {
    throw new UnauthenticatedAccessError(
      "Usuário não possui vínculo com nenhuma organização."
    );
  }

  const sessionToken = `ksess_${crypto.randomBytes(32).toString("hex")}`;
  await db.insert(schema.userSessions).values({
    sessionToken,
    userId: user.id,
    activeOrganizationId: primaryMembership.organizationId,
    expiresAt: new Date(nowMs + sessionTtlMs),
  });

  await db.insert(schema.auditLogs).values({
    organizationId: primaryMembership.organizationId,
    actorUserId: user.id,
    actorType: "USER",
    action: "AUTH_LOGIN_SUCCESS",
    entityType: "session",
    entityId: sessionToken.slice(0, 16),
    newState: {
      organizationId: primaryMembership.organizationId,
      role: primaryMembership.role,
    },
  });

  return await resolveSessionFromPostgres(db, {
    sessionToken,
    nowMs,
  });
}

/**
 * Resolves a persistent session token from `user_sessions` and returns the
 * authoritative server-validated `TenantContext`.
 */
export async function resolveSessionFromPostgres(
  db: DrizzleQueryExecutor,
  params: {
    readonly sessionToken: string | null | undefined;
    readonly requestedOrganizationId?: string;
    readonly nowMs?: number;
  }
): Promise<AuthenticatedPostgresSession> {
  const nowMs = params.nowMs ?? Date.now();
  const token = params.sessionToken?.trim();
  if (!token) {
    throw new UnauthenticatedAccessError("Sessão de autenticação ausente.");
  }

  const sessions: (typeof schema.userSessions.$inferSelect)[] = await db
    .select()
    .from(schema.userSessions)
    .where(eq(schema.userSessions.sessionToken, token));

  const session = sessions[0];
  if (!session) {
    throw new UnauthenticatedAccessError("Sessão inválida ou inexistente.");
  }

  if (session.revokedAt !== null) {
    throw new UnauthenticatedAccessError("Sessão encerrada (logout realizado).");
  }

  if (new Date(session.expiresAt).getTime() <= nowMs) {
    throw new UnauthenticatedAccessError("Sessão expirada. Faça login novamente.");
  }

  const usersFound: (typeof schema.users.$inferSelect)[] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId));

  const user = usersFound[0];
  if (!user || !user.isActive) {
    throw new UnauthenticatedAccessError("Usuário inativo ou não encontrado.");
  }

  const allUserMemberships: (typeof schema.memberships.$inferSelect)[] =
    await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, user.id));

  if (allUserMemberships.length === 0) {
    throw new UnauthenticatedAccessError(
      "Usuário sem associação a organizações."
    );
  }

  const targetOrgId =
    params.requestedOrganizationId?.trim() || session.activeOrganizationId;

  const activeMembership = allUserMemberships.find(
    (m) => m.organizationId === targetOrgId
  );

  if (!activeMembership) {
    throw new TenantIsolationError(
      session.activeOrganizationId,
      targetOrgId,
      `Usuário autenticado (${user.id}) não possui permissão para acessar a organização (${targetOrgId}).`
    );
  }

  const orgIds = allUserMemberships.map((m) => m.organizationId);
  const orgRows: (typeof schema.organizations.$inferSelect)[] = await db
    .select()
    .from(schema.organizations)
    .where(inArray(schema.organizations.id, orgIds));

  const activeOrg = orgRows.find((o) => o.id === activeMembership.organizationId);
  if (!activeOrg) {
    throw new TenantIsolationError(
      user.id,
      activeMembership.organizationId,
      "Organização ativa não encontrada."
    );
  }

  let allowedClientIds: readonly string[] | undefined;
  if (activeMembership.role === "CLIENT_VIEWER") {
    const clientAccessRows: (typeof schema.memberClientAccess.$inferSelect)[] =
      await db
        .select()
        .from(schema.memberClientAccess)
        .where(
          and(
            eq(
              schema.memberClientAccess.organizationId,
              activeMembership.organizationId
            ),
            eq(schema.memberClientAccess.membershipId, activeMembership.id)
          )
        );
    allowedClientIds = clientAccessRows.map((r) => r.clientId);
  }

  const availableOrganizations = allUserMemberships
    .map((m) => {
      const org = orgRows.find((o) => o.id === m.organizationId);
      if (!org) return null;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        role: m.role,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  return {
    sessionToken: session.sessionToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    },
    context: {
      organizationId: activeOrg.id,
      organizationSlug: activeOrg.slug,
      userId: user.id,
      role: activeMembership.role,
      executionMode: activeOrg.executionMode,
      emergencyStopActive: activeOrg.emergencyStopActive,
      allowedClientIds,
    },
    availableOrganizations,
  };
}

/**
 * Revokes an active user session in PostgreSQL and records an audit log entry.
 */
export async function revokeSessionInPostgres(
  db: DrizzleQueryExecutor,
  sessionToken: string
): Promise<void> {
  const trimmed = sessionToken.trim();
  if (!trimmed) return;

  const existing: (typeof schema.userSessions.$inferSelect)[] = await db
    .select()
    .from(schema.userSessions)
    .where(eq(schema.userSessions.sessionToken, trimmed));

  const sess = existing[0];
  if (!sess) return;

  await db
    .update(schema.userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.userSessions.sessionToken, trimmed));

  await db.insert(schema.auditLogs).values({
    organizationId: sess.activeOrganizationId,
    actorUserId: sess.userId,
    actorType: "USER",
    action: "AUTH_LOGOUT",
    entityType: "session",
    entityId: trimmed.slice(0, 16),
    newState: { revoked: true },
  });
}

/**
 * Switches the active organization on a persistent user session after verifying
 * server-side membership.
 */
export async function switchActiveOrganizationInPostgres(
  db: DrizzleQueryExecutor,
  params: {
    readonly sessionToken: string;
    readonly targetOrganizationId: string;
    readonly nowMs?: number;
  }
): Promise<AuthenticatedPostgresSession> {
  const resolved = await resolveSessionFromPostgres(db, {
    sessionToken: params.sessionToken,
    requestedOrganizationId: params.targetOrganizationId,
    nowMs: params.nowMs,
  });

  await db
    .update(schema.userSessions)
    .set({ activeOrganizationId: resolved.context.organizationId })
    .where(eq(schema.userSessions.sessionToken, params.sessionToken));

  await db.insert(schema.auditLogs).values({
    organizationId: resolved.context.organizationId,
    actorUserId: resolved.user.id,
    actorType: "USER",
    action: "ACTIVE_ORGANIZATION_SWITCHED",
    entityType: "organization",
    entityId: resolved.context.organizationId,
    newState: { activeOrganizationId: resolved.context.organizationId },
  });

  return resolved;
}

/**
 * Persistent Drizzle Tenant-Scoped Repository for all operational domains:
 * Organizations, Memberships, Clients, Integrations, Ad Accounts, Campaigns,
 * Daily Metrics, Budgets, Sync Runs, and Audit Logs.
 */
export class PersistentDrizzleTenantRepository {
  constructor(private readonly db: DrizzleQueryExecutor) {}

  public async getOrganization(
    context: TenantContext
  ): Promise<typeof schema.organizations.$inferSelect> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "dashboard:view");

    const rows: (typeof schema.organizations.$inferSelect)[] = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, authCtx.organizationId));

    const org = rows[0];
    if (!org) {
      throw new TenantIsolationError(
        authCtx.organizationId,
        authCtx.organizationId,
        "Organização não encontrada."
      );
    }
    return org;
  }

  public async updateOrganizationSettings(
    context: TenantContext,
    input: {
      readonly maxDailyBudgetChangePct?: number;
      readonly minCooldownMinutes?: number;
      readonly emergencyStopActive?: boolean;
      readonly emergencyStopReason?: string | null;
    }
  ): Promise<typeof schema.organizations.$inferSelect> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "automation:trigger_kill_switch");

    const current = await this.getOrganization(authCtx);

    const [updated] = await this.db
      .update(schema.organizations)
      .set({
        maxDailyBudgetChangePct:
          input.maxDailyBudgetChangePct ?? current.maxDailyBudgetChangePct,
        minCooldownMinutes:
          input.minCooldownMinutes ?? current.minCooldownMinutes,
        emergencyStopActive:
          input.emergencyStopActive ?? current.emergencyStopActive,
        emergencyStopReason:
          input.emergencyStopReason !== undefined
            ? input.emergencyStopReason
            : current.emergencyStopReason,
        updatedAt: new Date(),
      })
      .where(eq(schema.organizations.id, authCtx.organizationId))
      .returning();

    if (!updated) {
      throw new Error("Falha ao atualizar organização.");
    }

    await this.db.insert(schema.auditLogs).values({
      organizationId: authCtx.organizationId,
      actorUserId: authCtx.userId,
      actorType: "USER",
      action: "ORGANIZATION_SETTINGS_UPDATED",
      entityType: "organization",
      entityId: authCtx.organizationId,
      previousState: {
        maxDailyBudgetChangePct: current.maxDailyBudgetChangePct,
        minCooldownMinutes: current.minCooldownMinutes,
        emergencyStopActive: current.emergencyStopActive,
      },
      newState: {
        maxDailyBudgetChangePct: updated.maxDailyBudgetChangePct,
        minCooldownMinutes: updated.minCooldownMinutes,
        emergencyStopActive: updated.emergencyStopActive,
      },
    });

    return updated;
  }

  public async listClients(
    context: TenantContext,
    options?: { readonly includeInactive?: boolean }
  ): Promise<(typeof schema.clients.$inferSelect)[]> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "dashboard:view");

    const rows: (typeof schema.clients.$inferSelect)[] = await this.db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.organizationId, authCtx.organizationId));

    const activeFiltered = options?.includeInactive
      ? rows
      : rows.filter((c) => c.isActive);

    if (authCtx.role === "CLIENT_VIEWER") {
      const allowed = new Set(authCtx.allowedClientIds ?? []);
      return activeFiltered.filter((client) => allowed.has(client.id));
    }

    return activeFiltered;
  }

  public async createClient(
    context: TenantContext,
    input: {
      readonly name: string;
      readonly industry: string;
      readonly websiteUrl?: string;
      readonly monthlyBudgetCapCents: number;
      readonly targetCpaCents?: number;
      readonly targetRoas?: string;
    }
  ): Promise<typeof schema.clients.$inferSelect> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "automation:manage_rules");

    const [created] = await this.db
      .insert(schema.clients)
      .values({
        organizationId: authCtx.organizationId,
        name: input.name.trim(),
        industry: input.industry.trim(),
        websiteUrl: input.websiteUrl ?? null,
        monthlyBudgetCapCents: input.monthlyBudgetCapCents,
        targetCpaCents: input.targetCpaCents ?? null,
        targetRoas: input.targetRoas ?? null,
        isActive: true,
      })
      .returning();

    if (!created) {
      throw new Error("Falha ao criar cliente no PostgreSQL.");
    }

    await this.db.insert(schema.auditLogs).values({
      organizationId: authCtx.organizationId,
      actorUserId: authCtx.userId,
      actorType: "USER",
      action: "CLIENT_CREATED",
      entityType: "client",
      entityId: created.id,
      newState: {
        name: created.name,
        industry: created.industry,
        monthlyBudgetCapCents: created.monthlyBudgetCapCents,
      },
    });

    return created;
  }

  public async updateClient(
    context: TenantContext,
    input: {
      readonly clientId: string;
      readonly name: string;
      readonly industry: string;
      readonly monthlyBudgetCapCents: number;
      readonly targetCpaCents?: number | null;
    }
  ): Promise<typeof schema.clients.$inferSelect> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "automation:manage_rules");

    const existingRows: (typeof schema.clients.$inferSelect)[] = await this.db
      .select()
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.organizationId, authCtx.organizationId),
          eq(schema.clients.id, input.clientId)
        )
      );

    const existing = existingRows[0];
    if (!existing) {
      throw new TenantIsolationError(
        authCtx.organizationId,
        input.clientId,
        "Cliente não encontrado na organização ativa."
      );
    }

    const [updated] = await this.db
      .update(schema.clients)
      .set({
        name: input.name.trim(),
        industry: input.industry.trim(),
        monthlyBudgetCapCents: input.monthlyBudgetCapCents,
        targetCpaCents:
          input.targetCpaCents !== undefined
            ? input.targetCpaCents
            : existing.targetCpaCents,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.clients.organizationId, authCtx.organizationId),
          eq(schema.clients.id, input.clientId)
        )
      )
      .returning();

    if (!updated) {
      throw new Error("Falha ao atualizar cliente no PostgreSQL.");
    }

    await this.db.insert(schema.auditLogs).values({
      organizationId: authCtx.organizationId,
      actorUserId: authCtx.userId,
      actorType: "USER",
      action: "CLIENT_UPDATED",
      entityType: "client",
      entityId: updated.id,
      previousState: {
        name: existing.name,
        industry: existing.industry,
        monthlyBudgetCapCents: existing.monthlyBudgetCapCents,
      },
      newState: {
        name: updated.name,
        industry: updated.industry,
        monthlyBudgetCapCents: updated.monthlyBudgetCapCents,
      },
    });

    return updated;
  }

  public async deactivateClient(
    context: TenantContext,
    clientId: string
  ): Promise<typeof schema.clients.$inferSelect> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "automation:manage_rules");

    const existingRows: (typeof schema.clients.$inferSelect)[] = await this.db
      .select()
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.organizationId, authCtx.organizationId),
          eq(schema.clients.id, clientId)
        )
      );

    const existing = existingRows[0];
    if (!existing) {
      throw new TenantIsolationError(
        authCtx.organizationId,
        clientId,
        "Cliente não encontrado na organização ativa."
      );
    }

    const [updated] = await this.db
      .update(schema.clients)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.clients.organizationId, authCtx.organizationId),
          eq(schema.clients.id, clientId)
        )
      )
      .returning();

    if (!updated) {
      throw new Error("Falha ao inativar cliente no PostgreSQL.");
    }

    await this.db.insert(schema.auditLogs).values({
      organizationId: authCtx.organizationId,
      actorUserId: authCtx.userId,
      actorType: "USER",
      action: "CLIENT_DEACTIVATED",
      entityType: "client",
      entityId: updated.id,
      previousState: { isActive: existing.isActive },
      newState: { isActive: false },
    });

    return updated;
  }

  public async assignClientToViewer(
    context: TenantContext,
    params: {
      readonly membershipId: string;
      readonly clientId: string;
    }
  ): Promise<typeof schema.memberClientAccess.$inferSelect> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "integrations:manage");

    const [created] = await this.db
      .insert(schema.memberClientAccess)
      .values({
        organizationId: authCtx.organizationId,
        membershipId: params.membershipId,
        clientId: params.clientId,
      })
      .returning();

    if (!created) {
      throw new Error("Falha ao vincular escopo de cliente.");
    }

    await this.db.insert(schema.auditLogs).values({
      organizationId: authCtx.organizationId,
      actorUserId: authCtx.userId,
      actorType: "USER",
      action: "CLIENT_VIEWER_SCOPE_ASSIGNED",
      entityType: "member_client_access",
      entityId: created.id,
      newState: {
        membershipId: params.membershipId,
        clientId: params.clientId,
      },
    });

    return created;
  }

  public async updateMemberRole(
    context: TenantContext,
    params: {
      readonly membershipId: string;
      readonly newRole: UserRole;
    }
  ): Promise<typeof schema.memberships.$inferSelect> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "integrations:manage");

    const existingRows: (typeof schema.memberships.$inferSelect)[] =
      await this.db
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.organizationId, authCtx.organizationId),
            eq(schema.memberships.id, params.membershipId)
          )
        );

    const existing = existingRows[0];
    if (!existing) {
      throw new TenantIsolationError(
        authCtx.organizationId,
        params.membershipId,
        "Membro não pertence à organização ativa."
      );
    }

    const [updated] = await this.db
      .update(schema.memberships)
      .set({
        role: params.newRole,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.memberships.organizationId, authCtx.organizationId),
          eq(schema.memberships.id, params.membershipId)
        )
      )
      .returning();

    if (!updated) {
      throw new Error("Falha ao atualizar papel do membro.");
    }

    await this.db.insert(schema.auditLogs).values({
      organizationId: authCtx.organizationId,
      actorUserId: authCtx.userId,
      actorType: "USER",
      action: "MEMBER_PERMISSION_UPDATED",
      entityType: "membership",
      entityId: updated.id,
      previousState: { role: existing.role },
      newState: { role: updated.role },
    });

    return updated;
  }

  public async listAdAccounts(
    context: TenantContext,
    filter?: { readonly clientId?: string }
  ): Promise<(typeof schema.adAccounts.$inferSelect)[]> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "dashboard:view");

    if (filter?.clientId) {
      assertClientScopeAccess(authCtx, filter.clientId);
    }

    const conditions = [
      eq(schema.adAccounts.organizationId, authCtx.organizationId),
    ];
    if (filter?.clientId) {
      conditions.push(eq(schema.adAccounts.clientId, filter.clientId));
    }

    const rows: (typeof schema.adAccounts.$inferSelect)[] = await this.db
      .select()
      .from(schema.adAccounts)
      .where(and(...conditions));

    if (authCtx.role === "CLIENT_VIEWER") {
      const allowed = new Set(authCtx.allowedClientIds ?? []);
      return rows.filter((acc) => allowed.has(acc.clientId));
    }

    return rows;
  }

  public async toggleAdAccountSyncSelection(
    context: TenantContext,
    adAccountId: string
  ): Promise<typeof schema.adAccounts.$inferSelect> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "automation:manage_rules");

    const rows: (typeof schema.adAccounts.$inferSelect)[] = await this.db
      .select()
      .from(schema.adAccounts)
      .where(
        and(
          eq(schema.adAccounts.organizationId, authCtx.organizationId),
          eq(schema.adAccounts.id, adAccountId)
        )
      );

    const existing = rows[0];
    if (!existing) {
      throw new TenantIsolationError(
        authCtx.organizationId,
        adAccountId,
        "Conta de anúncios não encontrada na organização."
      );
    }

    const [updated] = await this.db
      .update(schema.adAccounts)
      .set({
        isSelectedForSync: !existing.isSelectedForSync,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.adAccounts.organizationId, authCtx.organizationId),
          eq(schema.adAccounts.id, adAccountId)
        )
      )
      .returning();

    if (!updated) {
      throw new Error("Falha ao atualizar seleção de conta.");
    }

    await this.db.insert(schema.auditLogs).values({
      organizationId: authCtx.organizationId,
      actorUserId: authCtx.userId,
      actorType: "USER",
      action: "AD_ACCOUNT_SYNC_SELECTION_CHANGED",
      entityType: "ad_account",
      entityId: updated.id,
      previousState: { isSelectedForSync: existing.isSelectedForSync },
      newState: { isSelectedForSync: updated.isSelectedForSync },
    });

    return updated;
  }

  /**
   * Lists integrations for the authenticated organization while stripping
   * `encryptedAccessToken` and `encryptedRefreshToken` so secrets never leave the vault.
   */
  public async listPublicIntegrations(context: TenantContext): Promise<
    Omit<
      typeof schema.integrations.$inferSelect,
      "encryptedAccessToken" | "encryptedRefreshToken"
    >[]
  > {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "dashboard:view");

    const rows: (typeof schema.integrations.$inferSelect)[] = await this.db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.organizationId, authCtx.organizationId));

    return rows.map(
      ({
        encryptedAccessToken: _eat,
        encryptedRefreshToken: _ert,
        ...publicFields
      }) => {
        void _eat;
        void _ert;
        return publicFields;
      }
    );
  }

  public async listCampaigns(
    context: TenantContext,
    filter?: { readonly clientId?: string; readonly adAccountId?: string }
  ): Promise<(typeof schema.campaigns.$inferSelect)[]> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "dashboard:view");

    if (filter?.clientId) {
      assertClientScopeAccess(authCtx, filter.clientId);
    }

    const allowedAccounts = await this.listAdAccounts(authCtx, {
      clientId: filter?.clientId,
    });
    const allowedAccountIds = new Set(
      allowedAccounts
        .filter((acc) =>
          filter?.adAccountId ? acc.id === filter.adAccountId : true
        )
        .map((acc) => acc.id)
    );

    if (allowedAccountIds.size === 0) {
      return [];
    }

    const campaigns: (typeof schema.campaigns.$inferSelect)[] = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.organizationId, authCtx.organizationId));

    return campaigns.filter((c) => allowedAccountIds.has(c.adAccountId));
  }

  public async upsertSyncedCampaign(
    context: TenantContext,
    input: {
      readonly adAccountId: string;
      readonly provider:
        | "GOOGLE_ADS"
        | "META_ADS"
        | "MICROSOFT_ADS"
        | "MOCK_ADS";
      readonly externalCampaignId: string;
      readonly name: string;
      readonly status:
        | "ENABLED"
        | "PAUSED"
        | "REMOVED"
        | "LIMITED_BY_BUDGET"
        | "LEARNING";
      readonly channelType: string;
      readonly biddingStrategy: string;
      readonly dailyBudgetCents: number;
      readonly isDemoData: boolean;
    }
  ): Promise<typeof schema.campaigns.$inferSelect> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertTenantAccess(authCtx, authCtx.organizationId);

    const existing: (typeof schema.campaigns.$inferSelect)[] = await this.db
      .select()
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.organizationId, authCtx.organizationId),
          eq(schema.campaigns.provider, input.provider),
          eq(schema.campaigns.externalCampaignId, input.externalCampaignId)
        )
      );

    if (existing[0]) {
      const [updated] = await this.db
        .update(schema.campaigns)
        .set({
          name: input.name,
          status: input.status,
          channelType: input.channelType,
          biddingStrategy: input.biddingStrategy,
          dailyBudgetCents: input.dailyBudgetCents,
          isDemoData: input.isDemoData,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.campaigns.organizationId, authCtx.organizationId),
            eq(schema.campaigns.id, existing[0].id)
          )
        )
        .returning();
      if (!updated) {
        throw new Error("Falha ao atualizar campanha.");
      }
      return updated;
    }

    const [inserted] = await this.db
      .insert(schema.campaigns)
      .values({
        organizationId: authCtx.organizationId,
        adAccountId: input.adAccountId,
        provider: input.provider,
        externalCampaignId: input.externalCampaignId,
        name: input.name,
        status: input.status,
        channelType: input.channelType,
        biddingStrategy: input.biddingStrategy,
        dailyBudgetCents: input.dailyBudgetCents,
        isDemoData: input.isDemoData,
      })
      .returning();

    if (!inserted) {
      throw new Error("Falha ao inserir campanha.");
    }
    return inserted;
  }

  public async listSyncRuns(
    context: TenantContext
  ): Promise<(typeof schema.syncRuns.$inferSelect)[]> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "dashboard:view");

    return await this.db
      .select()
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.organizationId, authCtx.organizationId))
      .orderBy(desc(schema.syncRuns.startedAt));
  }

  public async listAuditLogs(
    context: TenantContext,
    limit = 25
  ): Promise<(typeof schema.auditLogs.$inferSelect)[]> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "dashboard:view");

    const rows: (typeof schema.auditLogs.$inferSelect)[] = await this.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, authCtx.organizationId))
      .orderBy(desc(schema.auditLogs.createdAt));

    return rows.slice(0, limit);
  }

  /**
   * Computes aggregated dashboard metrics directly from persisted PostgreSQL records
   * (`campaigns`, `daily_metrics`, `budgets`).
   *
   * Section 13 Invariants:
   * - CTR, CPC, CPA, and ROAS are calculated over the aggregated totals (NEVER average of rates).
   * - Differentiates zero (`0`) from absence of data (`hasData: false`) and mathematical unavailability (`null`).
   */
  public async getAggregatedDashboardMetrics(
    context: TenantContext,
    filter: {
      readonly clientId?: string;
      readonly adAccountId?: string;
      readonly periodDays: number;
      readonly referenceDateIso?: string;
    }
  ): Promise<AggregatedPeriodMetricsResult> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "dashboard:view");

    const scopedCampaigns = await this.listCampaigns(authCtx, {
      clientId: filter.clientId,
      adAccountId: filter.adAccountId,
    });

    if (scopedCampaigns.length === 0) {
      return {
        hasData: false,
        periodDays: filter.periodDays,
        campaignCount: 0,
        totalSpendCents: 0,
        totalSpendBrl: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalConversions: 0,
        totalConversionValueCents: 0,
        totalAllocatedBudgetCents: 0,
        ctrPct: null,
        cpcCents: null,
        cpcBrl: null,
        cpaCents: null,
        cpaBrl: null,
        roas: null,
        timeline: [],
      };
    }

    const campaignIds = scopedCampaigns.map((c) => c.id);
    const refDate = filter.referenceDateIso
      ? new Date(`${filter.referenceDateIso}T00:00:00Z`)
      : new Date();
    const cutoffDate = new Date(
      refDate.getTime() - (filter.periodDays - 1) * 24 * 60 * 60 * 1000
    );
    const cutoffIsoDate = cutoffDate.toISOString().slice(0, 10);

    const metricRows: (typeof schema.dailyMetrics.$inferSelect)[] =
      await this.db
        .select()
        .from(schema.dailyMetrics)
        .where(
          and(
            eq(schema.dailyMetrics.organizationId, authCtx.organizationId),
            inArray(schema.dailyMetrics.campaignId, campaignIds),
            gte(schema.dailyMetrics.metricDate, cutoffIsoDate)
          )
        );

    const budgetRows: (typeof schema.budgets.$inferSelect)[] = await this.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.organizationId, authCtx.organizationId));

    const totalAllocatedBudgetCents = budgetRows
      .filter((b) => (filter.clientId ? b.clientId === filter.clientId : true))
      .reduce((acc, b) => acc + Number(b.allocatedCents), 0);

    if (metricRows.length === 0) {
      return {
        hasData: false,
        periodDays: filter.periodDays,
        campaignCount: scopedCampaigns.length,
        totalSpendCents: 0,
        totalSpendBrl: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalConversions: 0,
        totalConversionValueCents: 0,
        totalAllocatedBudgetCents,
        ctrPct: null,
        cpcCents: null,
        cpcBrl: null,
        cpaCents: null,
        cpaBrl: null,
        roas: null,
        timeline: [],
      };
    }

    let totalSpendCents = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalConversions = 0;
    let totalConversionValueCents = 0;

    const byDate = new Map<
      string,
      {
        spendCents: number;
        conversions: number;
        conversionValueCents: number;
        clicks: number;
        impressions: number;
        isDemoData: boolean;
      }
    >();

    for (const row of metricRows) {
      const costCents = Number(row.costCents);
      const conv = Number(row.conversions);
      const convValCents = Number(row.conversionValueCents);
      const clicks = Number(row.clicks);
      const impr = Number(row.impressions);

      totalSpendCents += costCents;
      totalImpressions += impr;
      totalClicks += clicks;
      totalConversions += conv;
      totalConversionValueCents += convValCents;

      const existingDate = byDate.get(row.metricDate);
      if (existingDate) {
        existingDate.spendCents += costCents;
        existingDate.conversions += conv;
        existingDate.conversionValueCents += convValCents;
        existingDate.clicks += clicks;
        existingDate.impressions += impr;
      } else {
        byDate.set(row.metricDate, {
          spendCents: costCents,
          conversions: conv,
          conversionValueCents: convValCents,
          clicks,
          impressions: impr,
          isDemoData: row.isDemoData,
        });
      }
    }

    const totalSpendBrl = Number((totalSpendCents / 100).toFixed(2));
    const ctrPct =
      totalImpressions > 0
        ? Number(((totalClicks / totalImpressions) * 100).toFixed(2))
        : null;
    const cpcCents =
      totalClicks > 0 ? Math.round(totalSpendCents / totalClicks) : null;
    const cpcBrl =
      cpcCents !== null ? Number((cpcCents / 100).toFixed(2)) : null;
    const cpaCents =
      totalConversions > 0
        ? Math.round(totalSpendCents / totalConversions)
        : null;
    const cpaBrl =
      cpaCents !== null ? Number((cpaCents / 100).toFixed(2)) : null;
    const roas =
      totalSpendCents > 0
        ? Number((totalConversionValueCents / totalSpendCents).toFixed(2))
        : null;

    const sortedDates = Array.from(byDate.keys()).sort();
    const timeline = sortedDates.map((dateStr) => {
      const d = byDate.get(dateStr)!;
      const spendBrl = Number((d.spendCents / 100).toFixed(2));
      const cpaDayBrl =
        d.conversions > 0
          ? Number((d.spendCents / 100 / d.conversions).toFixed(2))
          : 0;
      const roasDay =
        d.spendCents > 0
          ? Number((d.conversionValueCents / d.spendCents).toFixed(2))
          : 0;
      const [, month = "01", day = "01"] = dateStr.split("-");
      return {
        date: dateStr,
        label: `${day}/${month}`,
        spendBrl,
        conversions: d.conversions,
        clicks: d.clicks,
        impressions: d.impressions,
        cpaBrl: cpaDayBrl,
        roas: roasDay,
        isDemoData: d.isDemoData,
      };
    });

    return {
      hasData: true,
      periodDays: filter.periodDays,
      campaignCount: scopedCampaigns.length,
      totalSpendCents,
      totalSpendBrl,
      totalImpressions,
      totalClicks,
      totalConversions,
      totalConversionValueCents,
      totalAllocatedBudgetCents,
      ctrPct,
      cpcCents,
      cpcBrl,
      cpaCents,
      cpaBrl,
      roas,
      timeline,
    };
  }
}
