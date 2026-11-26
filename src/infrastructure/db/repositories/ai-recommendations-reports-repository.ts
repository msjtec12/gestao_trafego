import { and, desc, eq, inArray } from "drizzle-orm";
import type { TenantContext } from "@/domain/types";
import {
  assertAuthenticatedDbContext,
  type DrizzleQueryExecutor,
} from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";
import {
  assertClientScopeAccess,
  assertPermission,
  TenantIsolationError,
} from "@/security/rbac-and-tenant";
import { computeActionPayloadHash } from "@/security/vault-and-guards";
import {
  SupervisedAIOrchestrator,
  type AIAnalyzerDraftRecommendation,
  type CampaignTelemetrySnapshot,
} from "@/modules/ai/services/supervised-ai-orchestrator";

export interface PersistedRecommendationWithApproval {
  readonly id: string;
  readonly organizationId: string;
  readonly campaignId: string;
  readonly campaignName: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly analyzerService: string;
  readonly title: string;
  readonly diagnosis: string;
  readonly justification: string;
  readonly evidence: Record<string, string | number>;
  readonly proposedActionType: string;
  readonly proposedPayload: Record<string, unknown>;
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly requiresApproval: boolean;
  readonly status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "EXECUTED";
  readonly actionPayloadHash: string;
  readonly approvalId: string | null;
  readonly approvalDecisionNotes: string | null;
  readonly reviewedAtIso: string | null;
  readonly isDemoData: boolean;
  readonly createdAtIso: string;
}

export interface PersistedExecutiveReport {
  readonly id: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly title: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly executiveSummary: string;
  readonly metricsSnapshot: Record<string, unknown>;
  readonly createdAtIso: string;
}

/**
 * Persistent Drizzle Repository for Stage 3:
 * - Supervised AI Recommendations (`recommendations`)
 * - Payload-Bound Human Approvals (`approvals` with immutable SHA-256 `action_payload_hash`)
 * - Executive Client Reports (`reports`)
 *
 * All queries enforce explicit `organization_id` filters, RBAC permissions,
 * `CLIENT_VIEWER` scoping, and immutable `audit_logs` trails.
 */
export class PersistentAIRecommendationsAndReportsRepository {
  private readonly orchestrator = new SupervisedAIOrchestrator();

  constructor(private readonly db: DrizzleQueryExecutor) {}

  /**
   * Builds real telemetry snapshots directly from persisted PostgreSQL tables
   * (`campaigns`, `ad_accounts`, `clients`, `daily_metrics`, `search_terms`, `ads`, `conversions`)
   * and executes the 9 specialized AI services, persisting validated recommendations.
   */
  public async runSupervisedAIAnalysisAndPersist(
    context: TenantContext,
    options?: { readonly clientId?: string }
  ): Promise<{
    readonly createdCount: number;
    readonly blockedByPolicyCount: number;
    readonly generationMode: "VERCEL_AI_SDK_LLM" | "DETERMINISTIC_RULES_FALLBACK";
    readonly modelId: string;
    readonly recommendationIds: readonly string[];
  }> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "ai:analyze");

    if (options?.clientId) {
      assertClientScopeAccess(authCtx, options.clientId);
    }

    const orgRows = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, authCtx.organizationId));
    const activeOrg = orgRows[0];

    const clientRows = await this.db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.organizationId, authCtx.organizationId));

    const scopedClients = clientRows.filter(
      (c) =>
        c.isActive && (!options?.clientId || c.id === options.clientId)
    );
    const clientById = new Map(scopedClients.map((c) => [c.id, c]));

    const accountRows = await this.db
      .select()
      .from(schema.adAccounts)
      .where(eq(schema.adAccounts.organizationId, authCtx.organizationId));
    const scopedAccounts = accountRows.filter((a) =>
      clientById.has(a.clientId)
    );
    const accountById = new Map(scopedAccounts.map((a) => [a.id, a]));

    const campaignRows = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.organizationId, authCtx.organizationId));
    const scopedCampaigns = campaignRows.filter((c) =>
      accountById.has(c.adAccountId)
    );

    if (scopedCampaigns.length === 0) {
      return {
        createdCount: 0,
        blockedByPolicyCount: 0,
        generationMode: "DETERMINISTIC_RULES_FALLBACK",
        modelId: "deterministic-analyzer-v3",
        recommendationIds: [],
      };
    }

    const campaignIds = scopedCampaigns.map((c) => c.id);
    const [metricRows, searchTermRows, adGroupRows, conversionRows] =
      await Promise.all([
        this.db
          .select()
          .from(schema.dailyMetrics)
          .where(
            and(
              eq(schema.dailyMetrics.organizationId, authCtx.organizationId),
              inArray(schema.dailyMetrics.campaignId, campaignIds)
            )
          ),
        this.db
          .select()
          .from(schema.searchTerms)
          .where(
            and(
              eq(schema.searchTerms.organizationId, authCtx.organizationId),
              inArray(schema.searchTerms.campaignId, campaignIds)
            )
          ),
        this.db
          .select()
          .from(schema.adGroups)
          .where(
            and(
              eq(schema.adGroups.organizationId, authCtx.organizationId),
              inArray(schema.adGroups.campaignId, campaignIds)
            )
          ),
        this.db
          .select()
          .from(schema.conversions)
          .where(eq(schema.conversions.organizationId, authCtx.organizationId)),
      ]);

    const adGroupIds = adGroupRows.map((ag) => ag.id);
    const adRows =
      adGroupIds.length > 0
        ? await this.db
            .select()
            .from(schema.ads)
            .where(
              and(
                eq(schema.ads.organizationId, authCtx.organizationId),
                inArray(schema.ads.adGroupId, adGroupIds)
              )
            )
        : [];

    const snapshots: CampaignTelemetrySnapshot[] = scopedCampaigns.map((c) => {
      const acc = accountById.get(c.adAccountId)!;
      const client = clientById.get(acc.clientId)!;
      const cMetrics = metricRows.filter((m) => m.campaignId === c.id);
      const cTerms = searchTermRows.filter((t) => t.campaignId === c.id);
      const cGroupIds = new Set(
        adGroupRows.filter((ag) => ag.campaignId === c.id).map((ag) => ag.id)
      );
      const cAds = adRows.filter((ad) => cGroupIds.has(ad.adGroupId));
      const cConversions = conversionRows.filter(
        (conv) => conv.adAccountId === c.adAccountId
      );

      const spendCents = cMetrics.reduce(
        (sum, m) => sum + Number(m.costCents),
        0
      );
      const impressions = cMetrics.reduce(
        (sum, m) => sum + Number(m.impressions),
        0
      );
      const clicks = cMetrics.reduce((sum, m) => sum + Number(m.clicks), 0);
      const conversions = cMetrics.reduce(
        (sum, m) => sum + Number(m.conversions),
        0
      );
      const convValueCents = cMetrics.reduce(
        (sum, m) => sum + Number(m.conversionValueCents),
        0
      );

      const spendBrl = Number((spendCents / 100).toFixed(2));
      const conversionValueBrl = Number((convValueCents / 100).toFixed(2));
      const ctrPct =
        impressions > 0
          ? Number(((clicks / impressions) * 100).toFixed(2))
          : null;
      const cpcBrl =
        clicks > 0 ? Number((spendBrl / clicks).toFixed(2)) : null;
      const cpaBrl =
        conversions > 0 ? Number((spendBrl / conversions).toFixed(2)) : null;
      const roas =
        spendCents > 0
          ? Number((convValueCents / spendCents).toFixed(2))
          : null;

      return {
        campaignId: c.id,
        campaignName: c.name,
        clientId: client.id,
        clientName: client.name,
        clientTargetCpaBrl: client.targetCpaCents
          ? Number((client.targetCpaCents / 100).toFixed(2))
          : null,
        clientMonthlyBudgetCapBrl: Number(
          (Number(client.monthlyBudgetCapCents) / 100).toFixed(2)
        ),
        status: c.status,
        channelType: c.channelType,
        dailyBudgetBrl: Number((Number(c.dailyBudgetCents) / 100).toFixed(2)),
        spendBrl,
        impressions,
        clicks,
        conversions,
        conversionValueBrl,
        ctrPct,
        cpcBrl,
        cpaBrl,
        roas,
        searchTerms: cTerms.map((t) => ({
          term: t.searchTerm,
          costBrl: Number((Number(t.costCents) / 100).toFixed(2)),
          clicks: t.clicks,
          conversions: Number(t.conversions),
        })),
        adHeadlines: cAds.flatMap((ad) => ad.headlines),
        landingPageUrls: cAds.map((ad) => ad.finalUrl),
        activeConversionTags: cConversions.length,
      };
    });

    const analysisResult = await this.orchestrator.runFullSupervisedAnalysis({
      context: authCtx,
      campaigns: snapshots,
      maxDailyBudgetChangePct: activeOrg?.maxDailyBudgetChangePct ?? 20,
    });

    const recommendationIds: string[] = [];
    for (const draft of analysisResult.recommendations) {
      const saved = await this.persistRecommendationDraft(authCtx, draft);
      recommendationIds.push(saved.id);
    }

    await this.db.insert(schema.auditLogs).values({
      organizationId: authCtx.organizationId,
      actorUserId: authCtx.userId,
      actorType: "AI_ORCHESTRATOR",
      action: "AI_SUPERVISED_ANALYSIS_COMPLETED",
      entityType: "organization",
      entityId: authCtx.organizationId,
      newState: {
        createdCount: recommendationIds.length,
        blockedByPolicyCount: analysisResult.blockedByPolicyCount,
        generationMode: analysisResult.generationMode,
        modelId: analysisResult.modelId,
        servicesExecuted: analysisResult.servicesExecuted,
      },
    });

    return {
      createdCount: recommendationIds.length,
      blockedByPolicyCount: analysisResult.blockedByPolicyCount,
      generationMode: analysisResult.generationMode,
      modelId: analysisResult.modelId,
      recommendationIds,
    };
  }

  public async persistRecommendationDraft(
    context: TenantContext,
    draft: AIAnalyzerDraftRecommendation
  ): Promise<typeof schema.recommendations.$inferSelect> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "ai:analyze");

    const evidenceRecord: Record<string, string | number> = {};
    for (const ev of draft.evidence) {
      evidenceRecord[ev.metric] = `${ev.observedValue} (${ev.benchmarkOrTarget})`;
    }
    evidenceRecord._estimatedMonthlySavingsBrl = draft.estimatedMonthlySavingsBrl;
    evidenceRecord._proposedActionSummary = draft.proposedActionSummary;

    const [created] = await this.db
      .insert(schema.recommendations)
      .values({
        organizationId: authCtx.organizationId,
        campaignId: draft.campaignId,
        analyzerService: draft.analyzerService,
        title: draft.title,
        diagnosis: draft.diagnosis,
        justification: draft.justification,
        evidence: evidenceRecord,
        proposedActionType: draft.proposedActionType,
        proposedPayload: draft.proposedPayload,
        riskLevel: draft.riskLevel,
        requiresApproval: true,
        status: "PENDING",
        isDemoData: false,
      })
      .returning();

    if (!created) {
      throw new Error("Falha ao persistir recomendação IA no PostgreSQL.");
    }

    return created;
  }

  /**
   * Lists persisted recommendations enriched with their SHA-256 payload hash
   * and latest `ApprovalRecord` decision, respecting `CLIENT_VIEWER` isolation.
   */
  public async listRecommendations(
    context: TenantContext,
    filter?: { readonly clientId?: string }
  ): Promise<readonly PersistedRecommendationWithApproval[]> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "dashboard:view");

    if (filter?.clientId) {
      assertClientScopeAccess(authCtx, filter.clientId);
    }

    const [recRows, approvalRows, campaignRows, accountRows, clientRows] =
      await Promise.all([
        this.db
          .select()
          .from(schema.recommendations)
          .where(
            eq(schema.recommendations.organizationId, authCtx.organizationId)
          )
          .orderBy(desc(schema.recommendations.createdAt)),
        this.db
          .select()
          .from(schema.approvals)
          .where(eq(schema.approvals.organizationId, authCtx.organizationId))
          .orderBy(desc(schema.approvals.createdAt)),
        this.db
          .select()
          .from(schema.campaigns)
          .where(eq(schema.campaigns.organizationId, authCtx.organizationId)),
        this.db
          .select()
          .from(schema.adAccounts)
          .where(eq(schema.adAccounts.organizationId, authCtx.organizationId)),
        this.db
          .select()
          .from(schema.clients)
          .where(eq(schema.clients.organizationId, authCtx.organizationId)),
      ]);

    const campaignById = new Map(campaignRows.map((c) => [c.id, c]));
    const accountById = new Map(accountRows.map((a) => [a.id, a]));
    const clientById = new Map(clientRows.map((c) => [c.id, c]));
    const allowedViewerClients =
      authCtx.role === "CLIENT_VIEWER"
        ? new Set(authCtx.allowedClientIds ?? [])
        : null;

    const results: PersistedRecommendationWithApproval[] = [];
    for (const rec of recRows) {
      const camp = campaignById.get(rec.campaignId);
      const acc = camp ? accountById.get(camp.adAccountId) : undefined;
      const client = acc ? clientById.get(acc.clientId) : undefined;
      const clientId = client?.id ?? "";

      if (filter?.clientId && clientId !== filter.clientId) continue;
      if (allowedViewerClients && !allowedViewerClients.has(clientId)) continue;

      const latestApproval = approvalRows.find(
        (a) => a.recommendationId === rec.id
      );

      const actionPayloadHash =
        latestApproval?.actionPayloadHash ??
        computeActionPayloadHash({
          organizationId: rec.organizationId,
          campaignId: rec.campaignId,
          actionType: rec.proposedActionType,
          payload: rec.proposedPayload,
        });

      results.push({
        id: rec.id,
        organizationId: rec.organizationId,
        campaignId: rec.campaignId,
        campaignName: camp?.name ?? "Campanha",
        clientId,
        clientName: client?.name ?? "Cliente",
        analyzerService: rec.analyzerService,
        title: rec.title,
        diagnosis: rec.diagnosis,
        justification: rec.justification,
        evidence: rec.evidence,
        proposedActionType: rec.proposedActionType,
        proposedPayload: rec.proposedPayload,
        riskLevel: rec.riskLevel,
        requiresApproval: rec.requiresApproval,
        status: rec.status,
        actionPayloadHash,
        approvalId: latestApproval?.id ?? null,
        approvalDecisionNotes: latestApproval?.decisionNotes ?? null,
        reviewedAtIso: latestApproval?.reviewedAt
          ? latestApproval.reviewedAt.toISOString()
          : null,
        isDemoData: rec.isDemoData,
        createdAtIso: rec.createdAt.toISOString(),
      });
    }

    return results;
  }

  /**
   * Records an explicit human decision (`APPROVED` or `REJECTED`) on a persisted
   * recommendation, binding the `approvals` record to the immutable SHA-256
   * `action_payload_hash` and recording an immutable audit event.
   *
   * NOTE: Does NOT execute any live mutation on ad platforms (system remains READ_ONLY).
   */
  public async reviewRecommendationWithPayloadBoundApproval(
    context: TenantContext,
    input: {
      readonly recommendationId: string;
      readonly decision: "APPROVED" | "REJECTED";
      readonly decisionNotes?: string;
      readonly ttlHours?: number;
    }
  ): Promise<{
    readonly recommendation: typeof schema.recommendations.$inferSelect;
    readonly approval: typeof schema.approvals.$inferSelect;
  }> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "automation:approve_execution");

    const recRows = await this.db
      .select()
      .from(schema.recommendations)
      .where(
        and(
          eq(schema.recommendations.organizationId, authCtx.organizationId),
          eq(schema.recommendations.id, input.recommendationId)
        )
      );

    const rec = recRows[0];
    if (!rec) {
      throw new TenantIsolationError(
        authCtx.organizationId,
        input.recommendationId,
        "Recomendação não encontrada na organização ativa."
      );
    }

    if (rec.status !== "PENDING") {
      throw new Error(
        `Recomendação já foi revisada (status atual: ${rec.status}).`
      );
    }

    const actionPayloadHash = computeActionPayloadHash({
      organizationId: rec.organizationId,
      campaignId: rec.campaignId,
      actionType: rec.proposedActionType,
      payload: rec.proposedPayload,
    });

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + (input.ttlHours ?? 24) * 60 * 60 * 1000
    );

    const [approval] = await this.db
      .insert(schema.approvals)
      .values({
        organizationId: authCtx.organizationId,
        recommendationId: rec.id,
        requestedByUserId: authCtx.userId,
        reviewedByUserId: authCtx.userId,
        actionPayloadHash,
        status: input.decision,
        decisionNotes:
          input.decisionNotes?.trim() ||
          (input.decision === "APPROVED"
            ? "Aprovado explicitamente no Centro de Recomendações (READ_ONLY — sem mutação externa)."
            : "Rejeitado pelo gestor no Centro de Recomendações."),
        expiresAt,
        reviewedAt: now,
      })
      .returning();

    const [updatedRec] = await this.db
      .update(schema.recommendations)
      .set({
        status: input.decision,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.recommendations.organizationId, authCtx.organizationId),
          eq(schema.recommendations.id, rec.id)
        )
      )
      .returning();

    if (!approval || !updatedRec) {
      throw new Error("Falha ao persistir aprovação assinada no PostgreSQL.");
    }

    await this.db.insert(schema.auditLogs).values({
      organizationId: authCtx.organizationId,
      actorUserId: authCtx.userId,
      actorType: "USER",
      action:
        input.decision === "APPROVED"
          ? "RECOMMENDATION_APPROVED_PAYLOAD_BOUND"
          : "RECOMMENDATION_REJECTED",
      entityType: "approval",
      entityId: approval.id,
      previousState: { status: rec.status },
      newState: {
        recommendationId: rec.id,
        status: input.decision,
        actionPayloadHash,
        executionMode: "READ_ONLY",
      },
    });

    return { recommendation: updatedRec, approval };
  }

  /**
   * Generates and persists an Executive Report (`reports` table) for a client
   * based strictly on persisted PostgreSQL metrics.
   */
  public async generateAndPersistExecutiveReport(
    context: TenantContext,
    input: {
      readonly clientId: string;
      readonly periodStart: string;
      readonly periodEnd: string;
    }
  ): Promise<PersistedExecutiveReport> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "ai:analyze");
    assertClientScopeAccess(authCtx, input.clientId);

    const clientRows = await this.db
      .select()
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.organizationId, authCtx.organizationId),
          eq(schema.clients.id, input.clientId)
        )
      );
    const client = clientRows[0];
    if (!client) {
      throw new TenantIsolationError(
        authCtx.organizationId,
        input.clientId,
        "Cliente não encontrado na organização ativa."
      );
    }

    const accountRows = await this.db
      .select()
      .from(schema.adAccounts)
      .where(
        and(
          eq(schema.adAccounts.organizationId, authCtx.organizationId),
          eq(schema.adAccounts.clientId, client.id)
        )
      );
    const accountIds = accountRows.map((a) => a.id);

    const campaignRows =
      accountIds.length > 0
        ? await this.db
            .select()
            .from(schema.campaigns)
            .where(
              and(
                eq(schema.campaigns.organizationId, authCtx.organizationId),
                inArray(schema.campaigns.adAccountId, accountIds)
              )
            )
        : [];
    const campaignIds = campaignRows.map((c) => c.id);

    const metricRows =
      campaignIds.length > 0
        ? await this.db
            .select()
            .from(schema.dailyMetrics)
            .where(
              and(
                eq(schema.dailyMetrics.organizationId, authCtx.organizationId),
                inArray(schema.dailyMetrics.campaignId, campaignIds)
              )
            )
        : [];

    const filteredMetrics = metricRows.filter(
      (m) => m.metricDate >= input.periodStart && m.metricDate <= input.periodEnd
    );

    const pendingRecs =
      campaignIds.length > 0
        ? await this.db
            .select()
            .from(schema.recommendations)
            .where(
              and(
                eq(schema.recommendations.organizationId, authCtx.organizationId),
                inArray(schema.recommendations.campaignId, campaignIds),
                eq(schema.recommendations.status, "PENDING")
              )
            )
        : [];

    const spendCents = filteredMetrics.reduce(
      (sum, m) => sum + Number(m.costCents),
      0
    );
    const totalImpressions = filteredMetrics.reduce(
      (sum, m) => sum + Number(m.impressions),
      0
    );
    const totalClicks = filteredMetrics.reduce(
      (sum, m) => sum + Number(m.clicks),
      0
    );
    const totalConversions = filteredMetrics.reduce(
      (sum, m) => sum + Number(m.conversions),
      0
    );
    const totalConvValueCents = filteredMetrics.reduce(
      (sum, m) => sum + Number(m.conversionValueCents),
      0
    );

    const totalSpendBrl = Number((spendCents / 100).toFixed(2));
    const ctrPct =
      totalImpressions > 0
        ? Number(((totalClicks / totalImpressions) * 100).toFixed(2))
        : null;
    const cpaBrl =
      totalConversions > 0
        ? Number((totalSpendBrl / totalConversions).toFixed(2))
        : null;
    const roas =
      spendCents > 0
        ? Number((totalConvValueCents / spendCents).toFixed(2))
        : null;

    const draft = await this.orchestrator.generateExecutiveReportDraft({
      context: authCtx,
      clientName: client.name,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      totalSpendBrl,
      totalImpressions,
      totalClicks,
      totalConversions,
      cpaBrl,
      ctrPct,
      roas,
      activeRecommendationsCount: pendingRecs.length,
    });

    const metricsSnapshot: Record<string, unknown> = {
      totalSpendBrl,
      totalImpressions,
      totalClicks,
      totalConversions,
      cpaBrl,
      ctrPct,
      roas,
      highlights: draft.highlights,
      risksAndAlerts: draft.risksAndAlerts,
      nextSteps: draft.nextSteps,
      generationMode: draft.generationMode,
      modelId: draft.modelId,
    };

    const [savedReport] = await this.db
      .insert(schema.reports)
      .values({
        organizationId: authCtx.organizationId,
        clientId: client.id,
        title: draft.title,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        executiveSummary: draft.executiveSummary,
        metricsSnapshot,
      })
      .returning();

    if (!savedReport) {
      throw new Error("Falha ao persistir relatório executivo no PostgreSQL.");
    }

    await this.db.insert(schema.auditLogs).values({
      organizationId: authCtx.organizationId,
      actorUserId: authCtx.userId,
      actorType: "USER",
      action: "EXECUTIVE_REPORT_GENERATED",
      entityType: "report",
      entityId: savedReport.id,
      newState: {
        clientId: client.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        generationMode: draft.generationMode,
      },
    });

    return {
      id: savedReport.id,
      organizationId: savedReport.organizationId,
      clientId: savedReport.clientId,
      clientName: client.name,
      title: savedReport.title,
      periodStart: savedReport.periodStart,
      periodEnd: savedReport.periodEnd,
      executiveSummary: savedReport.executiveSummary,
      metricsSnapshot: savedReport.metricsSnapshot,
      createdAtIso: savedReport.createdAt.toISOString(),
    };
  }

  public async listExecutiveReports(
    context: TenantContext,
    filter?: { readonly clientId?: string }
  ): Promise<readonly PersistedExecutiveReport[]> {
    const authCtx = assertAuthenticatedDbContext(context);
    assertPermission(authCtx, "dashboard:view");

    if (filter?.clientId) {
      assertClientScopeAccess(authCtx, filter.clientId);
    }

    const [reportRows, clientRows] = await Promise.all([
      this.db
        .select()
        .from(schema.reports)
        .where(eq(schema.reports.organizationId, authCtx.organizationId))
        .orderBy(desc(schema.reports.createdAt)),
      this.db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.organizationId, authCtx.organizationId)),
    ]);

    const clientById = new Map(clientRows.map((c) => [c.id, c]));
    const allowedViewerClients =
      authCtx.role === "CLIENT_VIEWER"
        ? new Set(authCtx.allowedClientIds ?? [])
        : null;

    return reportRows
      .filter((r) => {
        if (filter?.clientId && r.clientId !== filter.clientId) return false;
        if (allowedViewerClients && !allowedViewerClients.has(r.clientId)) {
          return false;
        }
        return true;
      })
      .map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        clientId: r.clientId,
        clientName: clientById.get(r.clientId)?.name ?? "Cliente",
        title: r.title,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        executiveSummary: r.executiveSummary,
        metricsSnapshot: r.metricsSnapshot,
        createdAtIso: r.createdAt.toISOString(),
      }));
  }
}
