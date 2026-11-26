import type { TenantContext } from "@/domain/types";
import {
  assertClientScopeAccess,
  assertTenantAccess,
  TenantIsolationError,
} from "@/security/rbac-and-tenant";

export interface TenantEntityChain {
  readonly organizationId: string;
  readonly client: { readonly id: string; readonly organizationId: string };
  readonly adAccount: {
    readonly id: string;
    readonly organizationId: string;
    readonly clientId: string;
  };
  readonly campaign: {
    readonly id: string;
    readonly organizationId: string;
    readonly adAccountId: string;
  };
  readonly recommendation?: {
    readonly id: string;
    readonly organizationId: string;
    readonly campaignId: string;
  };
  readonly approval?: {
    readonly id: string;
    readonly organizationId: string;
    readonly recommendationId: string;
  };
}

/**
 * Validates the entire relational ownership chain:
 * Organization -> Client -> AdAccount -> Campaign -> Recommendation -> Approval.
 * Blocks any cross-tenant or mismatched parent-child relationship.
 */
export function validateTenantEntityChain(
  context: TenantContext,
  chain: TenantEntityChain
): void {
  assertTenantAccess(context, chain.organizationId);
  assertTenantAccess(context, chain.client.organizationId);
  assertTenantAccess(context, chain.adAccount.organizationId);
  assertTenantAccess(context, chain.campaign.organizationId);
  assertClientScopeAccess(context, chain.client.id);

  if (chain.adAccount.clientId !== chain.client.id) {
    throw new TenantIsolationError(
      chain.client.id,
      chain.adAccount.clientId,
      "AdAccount does not belong to the specified Client."
    );
  }

  if (chain.campaign.adAccountId !== chain.adAccount.id) {
    throw new TenantIsolationError(
      chain.adAccount.id,
      chain.campaign.adAccountId,
      "Campaign does not belong to the specified AdAccount."
    );
  }

  if (chain.recommendation) {
    assertTenantAccess(context, chain.recommendation.organizationId);
    if (chain.recommendation.campaignId !== chain.campaign.id) {
      throw new TenantIsolationError(
        chain.campaign.id,
        chain.recommendation.campaignId,
        "Recommendation does not belong to the specified Campaign."
      );
    }
  }

  if (chain.approval) {
    assertTenantAccess(context, chain.approval.organizationId);
    if (
      !chain.recommendation ||
      chain.approval.recommendationId !== chain.recommendation.id
    ) {
      throw new TenantIsolationError(
        chain.recommendation?.id ?? "NONE",
        chain.approval.recommendationId,
        "Approval does not match the specified Recommendation."
      );
    }
  }
}

/**
 * Generic tenant-scoped in-memory/query repository contract ensuring
 * every read and write operation is strictly scoped to context.organizationId.
 */
export class TenantScopedRepository<
  T extends { readonly id: string; readonly organizationId: string; readonly clientId?: string }
> {
  private readonly store = new Map<string, T>();

  constructor(initialRecords: readonly T[] = []) {
    for (const rec of initialRecords) {
      this.store.set(`${rec.organizationId}:${rec.id}`, rec);
    }
  }

  public list(context: TenantContext): T[] {
    if (!context.organizationId) {
      throw new TenantIsolationError("EMPTY", "UNKNOWN");
    }
    const items: T[] = [];
    for (const record of this.store.values()) {
      if (record.organizationId === context.organizationId) {
        if (record.clientId) {
          assertClientScopeAccess(context, record.clientId);
        }
        items.push(record);
      }
    }
    return items;
  }

  public findById(context: TenantContext, id: string): T | null {
    const record = this.store.get(`${context.organizationId}:${id}`) ?? null;
    if (!record) return null;
    assertTenantAccess(context, record.organizationId);
    if (record.clientId) {
      assertClientScopeAccess(context, record.clientId);
    }
    return record;
  }

  public save(context: TenantContext, record: T): T {
    assertTenantAccess(context, record.organizationId);
    if (record.clientId) {
      assertClientScopeAccess(context, record.clientId);
    }
    this.store.set(`${record.organizationId}:${record.id}`, record);
    return record;
  }
}
