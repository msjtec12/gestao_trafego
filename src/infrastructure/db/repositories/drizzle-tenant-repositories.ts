import { and, eq } from "drizzle-orm";
import type { TenantContext } from "@/domain/types";
import { assertAuthenticatedDbContext } from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";
import {
  assertClientScopeAccess,
  assertPermission,
  assertTenantAccess,
} from "@/security/rbac-and-tenant";
import { hashPasswordScrypt } from "@/security/auth-rate-limiter";
import {
  OnboardingInputSchema,
  type OnboardingInput,
} from "@/security/session-guard";

/**
 * Structural Drizzle database/transaction interface compatible with both
 * Neon PostgreSQL (`drizzle-orm/neon-serverless`) and disposable PostgreSQL (`drizzle-orm/pglite`).
 */
export interface DrizzleExecutor {
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<unknown[]>;
    };
  };
  insert: (table: unknown) => {
    values: (val: unknown) => {
      returning: () => Promise<unknown[]>;
    };
  };
  update: (table: unknown) => {
    set: (val: unknown) => {
      where: (cond: unknown) => {
        returning: () => Promise<unknown[]>;
      };
    };
  };
}

/**
 * Executes secure onboarding of a user and creation of their first organization.
 * Default executionMode is strictly enforced as 'READ_ONLY' and role is 'OWNER'.
 */
export async function onboardFirstOrganizationRepository(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  rawInput: OnboardingInput
): Promise<{
  readonly user: typeof schema.users.$inferSelect;
  readonly organization: typeof schema.organizations.$inferSelect;
  readonly membership: typeof schema.memberships.$inferSelect;
}> {
  const input = OnboardingInputSchema.parse(rawInput);
  const passwordHash = hashPasswordScrypt(input.password);

  const [createdUser] = await tx
    .insert(schema.users)
    .values({
      email: input.email.toLowerCase().trim(),
      fullName: input.fullName.trim(),
      passwordHash,
      isActive: true,
      lgpdConsentAt: new Date(),
    })
    .returning();

  const [createdOrg] = await tx
    .insert(schema.organizations)
    .values({
      name: input.organizationName.trim(),
      slug: input.organizationSlug.trim().toLowerCase(),
      executionMode: "READ_ONLY",
      emergencyStopActive: false,
      timezone: input.timezone,
      currencyCode: input.currencyCode,
    })
    .returning();

  const [createdMembership] = await tx
    .insert(schema.memberships)
    .values({
      organizationId: createdOrg.id,
      userId: createdUser.id,
      role: "OWNER",
    })
    .returning();

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
  };
}

/**
 * Persistent Drizzle Tenant-Scoped Repository for Clients, Ad Accounts, Campaigns & Audit Logs.
 * Every method validates the authenticated TenantContext, enforces RBAC and CLIENT_VIEWER scope,
 * and applies explicit `eq(table.organizationId, context.organizationId)` predicates on top of PostgreSQL RLS.
 */
export class PersistentDrizzleTenantRepository {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly db: any) {}

  public async listClients(
    context: TenantContext
  ): Promise<(typeof schema.clients.$inferSelect)[]> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "dashboard:view");

    const rows: (typeof schema.clients.$inferSelect)[] = await this.db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.organizationId, authCtx.organizationId));

    if (authCtx.role === "CLIENT_VIEWER") {
      const allowed = new Set(authCtx.allowedClientIds ?? []);
      return rows.filter((client) => allowed.has(client.id));
    }

    return rows;
  }

  public async createClient(
    context: TenantContext,
    input: {
      readonly name: string;
      readonly industry: string;
      readonly websiteUrl?: string;
      readonly monthlyBudgetCapCents: number;
      readonly targetCpaCents?: number;
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
      })
      .returning();

    await this.db.insert(schema.auditLogs).values({
      organizationId: authCtx.organizationId,
      actorUserId: authCtx.userId,
      actorType: "USER",
      action: "CLIENT_CREATED",
      entityType: "client",
      entityId: created.id,
      newState: { name: created.name, industry: created.industry },
    });

    return created;
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

    return created;
  }

  public async listCampaigns(
    context: TenantContext,
    filter?: { readonly adAccountId?: string }
  ): Promise<(typeof schema.campaigns.$inferSelect)[]> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "dashboard:view");

    const conditions = [
      eq(schema.campaigns.organizationId, authCtx.organizationId),
    ];
    if (filter?.adAccountId) {
      conditions.push(eq(schema.campaigns.adAccountId, filter.adAccountId));
    }

    const campaigns: (typeof schema.campaigns.$inferSelect)[] = await this.db
      .select()
      .from(schema.campaigns)
      .where(and(...conditions));

    if (authCtx.role === "CLIENT_VIEWER") {
      const accounts: (typeof schema.adAccounts.$inferSelect)[] = await this.db
        .select()
        .from(schema.adAccounts)
        .where(eq(schema.adAccounts.organizationId, authCtx.organizationId));

      const allowedAccounts = new Set(
        accounts
          .filter((acc) => {
            try {
              assertClientScopeAccess(authCtx, acc.clientId);
              return true;
            } catch {
              return false;
            }
          })
          .map((acc) => acc.id)
      );

      return campaigns.filter((c) => allowedAccounts.has(c.adAccountId));
    }

    return campaigns;
  }

  public async upsertSyncedCampaign(
    context: TenantContext,
    input: {
      readonly adAccountId: string;
      readonly provider: "GOOGLE_ADS" | "META_ADS" | "MICROSOFT_ADS" | "MOCK_ADS";
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

    return inserted;
  }
}
