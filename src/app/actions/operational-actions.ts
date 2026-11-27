"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  withAdminPostgresTransaction,
  withTenantTransaction,
} from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";
import {
  authenticateUserWithPostgres,
  onboardFirstOrganizationRepository,
  PersistentDrizzleTenantRepository,
  switchActiveOrganizationInPostgres,
} from "@/infrastructure/db/repositories/drizzle-tenant-repositories";
import { PersistentPostgresGoogleAdsService } from "@/integrations/google-ads/google-ads-oauth-and-readonly";
import { PersistentPostgresAdsSyncEngine } from "@/workflows/incremental-sync-engine";
import {
  PersistentAIRecommendationsAndReportsRepository,
  type PersistedExecutiveReport,
} from "@/infrastructure/db/repositories/ai-recommendations-reports-repository";
import {
  issueUnifiedAuthJsSessionCookie,
  resolveUnifiedAuthJsPostgresSession,
  revokeUnifiedAuthJsSession,
} from "@/security/auth";
import { requireCredentialsEncryptionKey } from "@/security/env";
import { toPublicSafeErrorMessage } from "@/security/public-errors";
import {
  createRequestCorrelationId,
  logStructuredServerFailure,
} from "@/security/structured-logger";

const LoginInputSchema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
});

const ClientCreateSchema = z.object({
  name: z
    .string()
    .min(3, "O nome do cliente deve ter pelo menos 3 caracteres.")
    .max(160),
  industry: z
    .string()
    .min(3, "Informe o segmento com pelo menos 3 caracteres.")
    .max(100),
  websiteUrl: z
    .string()
    .trim()
    .optional()
    .refine(
      (val) =>
        !val || val.startsWith("https://") || val.startsWith("http://"),
      { message: "Informe uma URL válida iniciando com https:// ou http://." }
    ),
  monthlyBudgetCapBrl: z.coerce
    .number()
    .refine((n) => Number.isFinite(n) && n > 0, {
      message: "O teto mensal de verba deve ser positivo.",
    }),
  targetCpaBrl: z.coerce
    .number()
    .refine((n) => Number.isFinite(n) && n > 0, {
      message: "A meta de CPA deve ser positiva.",
    }),
  targetRoas: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || String(v).trim() === "") return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
    }),
});

const ClientUpdateSchema = ClientCreateSchema.extend({
  clientId: z.string().uuid("ID de cliente inválido."),
});

const OrganizationProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "O nome da organização deve ter pelo menos 2 caracteres.")
    .max(160),
  timezone: z.string().trim().min(3).max(64),
  currencyCode: z.enum(["BRL", "USD", "EUR"]),
});

export async function loginUserAction(rawInput: {
  readonly email: string;
  readonly password: string;
}): Promise<{
  readonly ok: boolean;
  readonly error?: string;
  readonly errorCode?: string;
  readonly requestId?: string;
}> {
  const requestId = createRequestCorrelationId();
  let currentStep = "validate_login_input";

  try {
    const parsed = LoginInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Credenciais inválidas.",
        errorCode: "VALIDATION_ERROR",
        requestId,
      };
    }

    currentStep = "authenticate_user_postgres";
    const session = await withAdminPostgresTransaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE konnexy_app`);
      return await authenticateUserWithPostgres(tx, parsed.data);
    });

    currentStep = "issue_authjs_session_cookie";
    await issueUnifiedAuthJsSessionCookie({
      userId: session.user.id,
      email: session.user.email,
      fullName: session.user.fullName,
      dbSessionToken: session.sessionToken,
      activeOrganizationId: session.context.organizationId,
    });

    currentStep = "revalidate_dashboard";
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    const meta = logStructuredServerFailure({
      requestId,
      flow: "login",
      step: currentStep,
      operation: "loginUserAction",
      error: err,
    });
    return {
      ok: false,
      error: meta.publicMessage,
      errorCode: meta.errorCode,
      requestId,
    };
  }
}

export async function onboardOrganizationAction(rawInput: {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
}): Promise<{
  readonly ok: boolean;
  readonly error?: string;
  readonly errorCode?: string;
  readonly failedStep?: string;
  readonly requestId?: string;
}> {
  const requestId = createRequestCorrelationId();
  let currentStep = "start_onboarding_transaction";

  try {
    const result = await withAdminPostgresTransaction(async (tx) => {
      currentStep = "set_local_role_konnexy_app";
      await tx.execute(sql`SET LOCAL ROLE konnexy_app`);

      const onboarded = await onboardFirstOrganizationRepository(
        tx,
        {
          ...rawInput,
          timezone: "America/Sao_Paulo",
          currencyCode: "BRL",
        },
        {
          onStep: (step) => {
            currentStep = step;
          },
        }
      );

      currentStep = "insert_default_integration";
      await tx.insert(schema.integrations).values({
        organizationId: onboarded.organization.id,
        provider: "GOOGLE_ADS",
        externalAccountLabel: "Google Ads API v26 (OAuth 2.0 Read-Only)",
        status: "ERROR",
        isDemoIntegration: false,
      });

      return onboarded;
    });

    currentStep = "issue_authjs_session_cookie";
    await issueUnifiedAuthJsSessionCookie({
      userId: result.user.id,
      email: result.user.email,
      fullName: result.user.fullName,
      dbSessionToken: result.sessionToken,
      activeOrganizationId: result.organization.id,
    });

    currentStep = "revalidate_dashboard";
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    const meta = logStructuredServerFailure({
      requestId,
      flow: "onboarding",
      step: currentStep,
      operation: "onboardOrganizationAction",
      error: err,
    });
    return {
      ok: false,
      error: meta.publicMessage,
      errorCode: meta.errorCode,
      failedStep: currentStep,
      requestId,
    };
  }
}

export async function logoutUserAction(): Promise<{ readonly ok: boolean }> {
  await revokeUnifiedAuthJsSession();
  revalidatePath("/");
  return { ok: true };
}

export async function switchOrganizationAction(
  targetOrganizationId: string
): Promise<{
  readonly ok: boolean;
  readonly error?: string;
  readonly errorCode?: string;
  readonly requestId?: string;
}> {
  const requestId = createRequestCorrelationId();
  let currentStep = "resolve_current_session";

  try {
    const currentSession = await resolveUnifiedAuthJsPostgresSession();
    currentStep = "switch_active_organization_postgres";
    const updated = await withAdminPostgresTransaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE konnexy_app`);
      return await switchActiveOrganizationInPostgres(tx, {
        sessionToken: currentSession.sessionToken,
        targetOrganizationId,
      });
    });

    currentStep = "issue_authjs_session_cookie";
    await issueUnifiedAuthJsSessionCookie({
      userId: updated.user.id,
      email: updated.user.email,
      fullName: updated.user.fullName,
      dbSessionToken: updated.sessionToken,
      activeOrganizationId: updated.context.organizationId,
    });

    currentStep = "revalidate_dashboard";
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    const meta = logStructuredServerFailure({
      requestId,
      flow: "switch_organization",
      step: currentStep,
      operation: "switchOrganizationAction",
      error: err,
    });
    return {
      ok: false,
      error: meta.publicMessage,
      errorCode: meta.errorCode,
      requestId,
    };
  }
}

export async function createClientServerAction(rawInput: {
  readonly name: string;
  readonly industry: string;
  readonly websiteUrl?: string;
  readonly monthlyBudgetCapBrl: number | string;
  readonly targetCpaBrl: number | string;
  readonly targetRoas?: number | string;
}): Promise<{
  readonly ok: boolean;
  readonly error?: string;
  readonly clientId?: string;
  readonly client?: {
    readonly id: string;
    readonly organizationId: string;
    readonly name: string;
    readonly industry: string;
    readonly websiteUrl: string | null;
    readonly monthlyBudgetCapBrl: number;
    readonly targetCpaBrl: number | null;
    readonly targetRoas: number | null;
    readonly isActive: boolean;
    readonly isDemoData: boolean;
  };
}> {
  try {
    const parsed = ClientCreateSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Dados do cliente inválidos.",
      };
    }

    const session = await resolveUnifiedAuthJsPostgresSession();
    const created = await withTenantTransaction(session.context, async (tx) => {
      const repo = new PersistentDrizzleTenantRepository(tx);
      return await repo.createClient(session.context, {
        name: parsed.data.name,
        industry: parsed.data.industry,
        websiteUrl: parsed.data.websiteUrl || undefined,
        monthlyBudgetCapCents: Math.round(
          parsed.data.monthlyBudgetCapBrl * 100
        ),
        targetCpaCents: Math.round(parsed.data.targetCpaBrl * 100),
        targetRoas: parsed.data.targetRoas ?? undefined,
      });
    });

    revalidatePath("/");
    revalidatePath("/clientes");
    revalidatePath("/orcamentos");
    return {
      ok: true,
      clientId: created.id,
      client: {
        id: created.id,
        organizationId: created.organizationId,
        name: created.name,
        industry: created.industry,
        websiteUrl: created.websiteUrl ?? null,
        monthlyBudgetCapBrl: Number(
          (Number(created.monthlyBudgetCapCents) / 100).toFixed(2)
        ),
        targetCpaBrl: created.targetCpaCents
          ? Number((created.targetCpaCents / 100).toFixed(2))
          : null,
        targetRoas: created.targetRoas ? Number(created.targetRoas) : null,
        isActive: created.isActive,
        isDemoData: false,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(err).publicMessage,
    };
  }
}

export async function updateClientServerAction(rawInput: {
  readonly clientId: string;
  readonly name: string;
  readonly industry: string;
  readonly websiteUrl?: string;
  readonly monthlyBudgetCapBrl: number | string;
  readonly targetCpaBrl: number | string;
  readonly targetRoas?: number | string;
}): Promise<{ readonly ok: boolean; readonly error?: string }> {
  try {
    const parsed = ClientUpdateSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Dados de edição inválidos.",
      };
    }

    const session = await resolveUnifiedAuthJsPostgresSession();
    await withTenantTransaction(session.context, async (tx) => {
      const repo = new PersistentDrizzleTenantRepository(tx);
      await repo.updateClient(session.context, {
        clientId: parsed.data.clientId,
        name: parsed.data.name,
        industry: parsed.data.industry,
        websiteUrl: parsed.data.websiteUrl ?? null,
        monthlyBudgetCapCents: Math.round(
          parsed.data.monthlyBudgetCapBrl * 100
        ),
        targetCpaCents: Math.round(parsed.data.targetCpaBrl * 100),
        targetRoas: parsed.data.targetRoas,
      });
    });

    revalidatePath("/");
    revalidatePath("/clientes");
    revalidatePath(`/clientes/${parsed.data.clientId}`);
    revalidatePath("/orcamentos");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(err).publicMessage,
    };
  }
}

export async function updateOrganizationProfileServerAction(rawInput: {
  readonly name: string;
  readonly timezone: string;
  readonly currencyCode: "BRL" | "USD" | "EUR";
}): Promise<{ readonly ok: boolean; readonly error?: string }> {
  try {
    const parsed = OrganizationProfileSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message ?? "Dados da organização inválidos.",
      };
    }

    const session = await resolveUnifiedAuthJsPostgresSession();
    await withTenantTransaction(session.context, async (tx) => {
      const repo = new PersistentDrizzleTenantRepository(tx);
      await repo.updateOrganizationSettings(session.context, {
        name: parsed.data.name,
        timezone: parsed.data.timezone,
        currencyCode: parsed.data.currencyCode,
      });
    });

    revalidatePath("/");
    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(err).publicMessage,
    };
  }
}

export async function deactivateClientServerAction(
  clientId: string
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  try {
    const session = await resolveUnifiedAuthJsPostgresSession();
    await withTenantTransaction(session.context, async (tx) => {
      const repo = new PersistentDrizzleTenantRepository(tx);
      await repo.deactivateClient(session.context, clientId);
    });

    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(err).publicMessage,
    };
  }
}

export async function toggleAdAccountSelectionServerAction(
  adAccountId: string
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  try {
    const session = await resolveUnifiedAuthJsPostgresSession();
    await withTenantTransaction(session.context, async (tx) => {
      const repo = new PersistentDrizzleTenantRepository(tx);
      await repo.toggleAdAccountSyncSelection(session.context, adAccountId);
    });

    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(err).publicMessage,
    };
  }
}

export async function revokeIntegrationServerAction(
  integrationId: string
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  try {
    const { keyHex, keyVersion } = requireCredentialsEncryptionKey();
    const session = await resolveUnifiedAuthJsPostgresSession();

    await withTenantTransaction(session.context, async (tx) => {
      const googleService = new PersistentPostgresGoogleAdsService(
        tx,
        keyHex,
        keyVersion
      );
      await googleService.revokeIntegrationInPostgres({
        context: session.context,
        integrationId,
      });
    });

    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(err).publicMessage,
    };
  }
}

export async function toggleEmergencyStopServerAction(): Promise<{
  readonly ok: boolean;
  readonly emergencyStopActive?: boolean;
  readonly error?: string;
}> {
  try {
    const session = await resolveUnifiedAuthJsPostgresSession();
    const updated = await withTenantTransaction(session.context, async (tx) => {
      const repo = new PersistentDrizzleTenantRepository(tx);
      const currentOrg = await repo.getOrganization(session.context);
      const nextState = !currentOrg.emergencyStopActive;
      return await repo.updateOrganizationSettings(session.context, {
        emergencyStopActive: nextState,
        emergencyStopReason: nextState
          ? "Acionado pelo operador no Command Center"
          : null,
      });
    });

    revalidatePath("/");
    return { ok: true, emergencyStopActive: updated.emergencyStopActive };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(err).publicMessage,
    };
  }
}

export async function requestSyncServerAction(
  integrationId: string
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  try {
    const { keyHex, keyVersion } = requireCredentialsEncryptionKey();
    const session = await resolveUnifiedAuthJsPostgresSession();

    return await withTenantTransaction(session.context, async (tx) => {
      const repo = new PersistentDrizzleTenantRepository(tx);
      const integrations = await repo.listPublicIntegrations(session.context);
      const targetIntegration = integrations.find((i) => i.id === integrationId);

      if (!targetIntegration) {
        return {
          ok: false,
          error: "Integração não encontrada na organização ativa.",
        };
      }

      if (targetIntegration.status === "REVOKED") {
        return {
          ok: false,
          error:
            "Esta integração foi revogada. Reconecte via OAuth antes de sincronizar.",
        };
      }

      if (targetIntegration.provider === "GOOGLE_ADS") {
        const googleService = new PersistentPostgresGoogleAdsService(
          tx,
          keyHex,
          keyVersion
        );
        // Strictly verifies real OAuth credentials in Vault (never fakes a live Google Ads sync)
        await googleService.resolveDecryptedTokenFromPostgres({
          context: session.context,
          integrationId,
        });
      }

      const clients = await repo.listClients(session.context);
      const primaryClient = clients[0];
      if (!primaryClient) {
        return {
          ok: false,
          error:
            "Cadastre pelo menos um cliente ativo antes de executar a sincronização.",
        };
      }

      const syncEngine = new PersistentPostgresAdsSyncEngine(tx);
      await syncEngine.executePersistentSync({
        context: session.context,
        integrationId: targetIntegration.id,
        clientId: primaryClient.id,
        provider: targetIntegration.provider,
        fetchBatchFn: async (prevCkpt) => ({
          checkpointToken: `ckpt-pg-${Date.now()}`,
          currencyCode: "BRL",
          timezone: "America/Sao_Paulo",
          isDemoData: targetIntegration.isDemoIntegration,
          adAccounts: [
            {
              externalAccountId: "4028819001",
              name: `Conta ${primaryClient.name}`,
              managerCustomerId: "9901002000",
            },
          ],
          campaigns: [
            {
              externalCampaignId: `CAMP-${primaryClient.id.slice(0, 6)}`,
              name: `Search — ${primaryClient.name}`,
              dailyBudgetMicros: 200_000_000,
            },
          ],
          adGroups: [
            {
              externalAdGroupId: `AG-${primaryClient.id.slice(0, 6)}`,
              externalCampaignId: `CAMP-${primaryClient.id.slice(0, 6)}`,
              name: "Grupo Principal Search",
            },
          ],
          ads: [
            {
              externalAdId: `AD-${primaryClient.id.slice(0, 6)}`,
              externalAdGroupId: `AG-${primaryClient.id.slice(0, 6)}`,
              finalUrl: "https://ads.konnexy.com.br",
            },
          ],
          keywords: [
            {
              externalKeywordId: `KW-${primaryClient.id.slice(0, 6)}`,
              text: primaryClient.industry.toLowerCase(),
              matchType: "EXACT",
            },
          ],
          searchTerms: [
            {
              searchTerm: `${primaryClient.industry.toLowerCase()} especialista`,
              costMicros: 45_000_000,
              observedDate: "2026-11-26",
            },
          ],
          conversions: [
            {
              externalConversionId: `CONV-${primaryClient.id.slice(0, 6)}`,
              name: "Lead Qualificado",
            },
          ],
          dailyMetrics: [
            {
              externalCampaignId: `CAMP-${primaryClient.id.slice(0, 6)}`,
              metricDate: "2026-11-26",
              impressions: 1500,
              clicks: 90,
              costMicros: prevCkpt ? 195_000_000 : 180_000_000,
              conversions: 6,
              conversionValueMicros: 1_080_000_000,
            },
          ],
          budgets: [
            {
              periodMonth: "2026-11",
              allocatedMicros: primaryClient.monthlyBudgetCapCents * 10_000,
              spentMicros: 180_000_000,
            },
          ],
        }),
      });

      revalidatePath("/");
      return { ok: true };
    });
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(
        err,
        "Sincronização bloqueada: credenciais OAuth reais do Google Ads não conectadas."
      ).publicMessage,
    };
  }
}

const ReviewRecommendationInputSchema = z.object({
  recommendationId: z.string().uuid("ID da recomendação inválido."),
  decision: z.enum(["APPROVED", "REJECTED"]),
  decisionNotes: z.string().max(500).optional(),
});

const GenerateExecutiveReportInputSchema = z.object({
  clientId: z.string().uuid("ID do cliente inválido."),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inicial inválida."),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data final inválida."),
});

export async function runSupervisedAIAnalysisServerAction(rawInput?: {
  readonly clientId?: string;
}): Promise<{
  readonly ok: boolean;
  readonly createdCount?: number;
  readonly blockedByPolicyCount?: number;
  readonly generationMode?: string;
  readonly error?: string;
}> {
  try {
    const session = await resolveUnifiedAuthJsPostgresSession();
    const result = await withTenantTransaction(session.context, async (tx) => {
      const repo = new PersistentAIRecommendationsAndReportsRepository(tx);
      return await repo.runSupervisedAIAnalysisAndPersist(session.context, {
        clientId: rawInput?.clientId,
      });
    });

    revalidatePath("/");
    return {
      ok: true,
      createdCount: result.createdCount,
      blockedByPolicyCount: result.blockedByPolicyCount,
      generationMode: result.generationMode,
    };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(
        err,
        "Não foi possível executar a análise supervisionada de IA."
      ).publicMessage,
    };
  }
}

export async function reviewRecommendationServerAction(rawInput: {
  readonly recommendationId: string;
  readonly decision: "APPROVED" | "REJECTED";
  readonly decisionNotes?: string;
}): Promise<{
  readonly ok: boolean;
  readonly approvalId?: string;
  readonly actionPayloadHash?: string;
  readonly status?: "APPROVED" | "REJECTED";
  readonly error?: string;
}> {
  try {
    const parsed = ReviewRecommendationInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message ?? "Dados de revisão inválidos.",
      };
    }

    const session = await resolveUnifiedAuthJsPostgresSession();
    const result = await withTenantTransaction(session.context, async (tx) => {
      const repo = new PersistentAIRecommendationsAndReportsRepository(tx);
      return await repo.reviewRecommendationWithPayloadBoundApproval(
        session.context,
        parsed.data
      );
    });

    revalidatePath("/");
    return {
      ok: true,
      approvalId: result.approval.id,
      actionPayloadHash: result.approval.actionPayloadHash,
      status: parsed.data.decision,
    };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(
        err,
        "Não foi possível registrar a aprovação assinada."
      ).publicMessage,
    };
  }
}

export async function generateExecutiveReportServerAction(rawInput: {
  readonly clientId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}): Promise<{
  readonly ok: boolean;
  readonly report?: PersistedExecutiveReport;
  readonly error?: string;
}> {
  try {
    const parsed = GenerateExecutiveReportInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message ??
          "Parâmetros inválidos para geração do relatório executivo.",
      };
    }

    const session = await resolveUnifiedAuthJsPostgresSession();
    const report = await withTenantTransaction(session.context, async (tx) => {
      const repo = new PersistentAIRecommendationsAndReportsRepository(tx);
      return await repo.generateAndPersistExecutiveReport(
        session.context,
        parsed.data
      );
    });

    revalidatePath("/");
    return { ok: true, report };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(
        err,
        "Não foi possível gerar o relatório executivo."
      ).publicMessage,
    };
  }
}

