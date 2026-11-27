"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
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
import {
  normalizeGoogleAdsCustomerId,
  PersistentPostgresGoogleAdsService,
} from "@/integrations/google-ads/google-ads-oauth-and-readonly";
import {
  GoogleAdsLiveSyncAdapter,
  validateSyncDateRange,
  type DiscoveredGoogleAdsAccount,
} from "@/integrations/google-ads/google-ads-live-sync-adapter";
import { PersistentPostgresAdsSyncEngine } from "@/workflows/incremental-sync-engine";
import { assertVerifiedOperationalDataForAI } from "@/infrastructure/db/reconciliation/data-integrity-reconciler";
import {
  PersistentAIRecommendationsAndReportsRepository,
  type PersistedExecutiveReport,
} from "@/infrastructure/db/repositories/ai-recommendations-reports-repository";
import {
  issueUnifiedAuthJsSessionCookie,
  resolveUnifiedAuthJsPostgresSession,
  revokeUnifiedAuthJsSession,
} from "@/security/auth";
import {
  requireCredentialsEncryptionKey,
  requireGoogleAdsOAuthConfig,
} from "@/security/env";
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
});

const ClientUpdateSchema = ClientCreateSchema.extend({
  clientId: z.string().uuid("ID de cliente inválido."),
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
  readonly monthlyBudgetCapBrl: number | string;
  readonly targetCpaBrl: number | string;
}): Promise<{
  readonly ok: boolean;
  readonly error?: string;
  readonly clientId?: string;
  readonly client?: {
    readonly id: string;
    readonly organizationId: string;
    readonly name: string;
    readonly industry: string;
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
        monthlyBudgetCapCents: Math.round(
          parsed.data.monthlyBudgetCapBrl * 100
        ),
        targetCpaCents: Math.round(parsed.data.targetCpaBrl * 100),
      });
    });

    revalidatePath("/");
    return {
      ok: true,
      clientId: created.id,
      client: {
        id: created.id,
        organizationId: created.organizationId,
        name: created.name,
        industry: created.industry,
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
  readonly monthlyBudgetCapBrl: number | string;
  readonly targetCpaBrl: number | string;
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
        monthlyBudgetCapCents: Math.round(
          parsed.data.monthlyBudgetCapBrl * 100
        ),
        targetCpaCents: Math.round(parsed.data.targetCpaBrl * 100),
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

const BindGoogleAdsAccountSchema = z.object({
  integrationId: z.string().uuid("ID da integração inválido."),
  clientId: z.string().uuid("Selecione um cliente explícito para vincular a conta."),
  externalAccountId: z.string().min(10, "Informe um Customer ID Google Ads de 10 dígitos."),
  accountName: z.string().min(2).max(160),
  managerCustomerId: z.string().nullable().optional(),
  isMccAccount: z.boolean().default(false),
  currencyCode: z.string().length(3).default("BRL"),
  timezone: z.string().min(3).max(64).default("America/Sao_Paulo"),
});

/**
 * Discovers real authorized Google Ads accounts (individual and MCC hierarchies)
 * directly from the official Google Ads API (`listAccessibleCustomers` + `customer_client`).
 * Never auto-assigns accounts to clients.
 */
export async function discoverGoogleAdsAccountsServerAction(
  integrationId: string
): Promise<{
  readonly ok: boolean;
  readonly accounts?: readonly DiscoveredGoogleAdsAccount[];
  readonly error?: string;
}> {
  try {
    const { keyHex, keyVersion } = requireCredentialsEncryptionKey();
    const oauthConfig = requireGoogleAdsOAuthConfig();
    const session = await resolveUnifiedAuthJsPostgresSession();

    const accounts = await withTenantTransaction(
      session.context,
      async (tx) => {
        const repo = new PersistentDrizzleTenantRepository(tx);
        const integrations = await repo.listPublicIntegrations(session.context);
        const target = integrations.find((i) => i.id === integrationId);
        if (!target || target.provider !== "GOOGLE_ADS") {
          throw new Error("Integração Google Ads não encontrada na organização ativa.");
        }
        if (target.status !== "CONNECTED") {
          throw new Error(
            "Integração Google Ads não está conectada. Conclua a autorização OAuth 2.0 antes de descobrir contas."
          );
        }

        const googleService = new PersistentPostgresGoogleAdsService(
          tx,
          keyHex,
          keyVersion
        );
        const adapter = new GoogleAdsLiveSyncAdapter(googleService);
        return await adapter.discoverAuthorizedAccounts({
          context: session.context,
          integrationId: target.id,
          oauthClientId: oauthConfig.clientId,
          oauthClientSecret: oauthConfig.clientSecret,
        });
      }
    );

    return { ok: true, accounts };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(
        err,
        "Não foi possível descobrir as contas autorizadas na Google Ads API."
      ).publicMessage,
    };
  }
}

/**
 * Explicitly binds a real discovered Google Ads customer_id to an explicitly chosen client.
 * Never assigns automatically to `clients[0]`.
 */
export async function bindGoogleAdsAccountToClientServerAction(rawInput: {
  readonly integrationId: string;
  readonly clientId: string;
  readonly externalAccountId: string;
  readonly accountName: string;
  readonly managerCustomerId?: string | null;
  readonly isMccAccount?: boolean;
  readonly currencyCode?: string;
  readonly timezone?: string;
}): Promise<{
  readonly ok: boolean;
  readonly adAccountId?: string;
  readonly error?: string;
}> {
  try {
    const parsed = BindGoogleAdsAccountSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message ??
          "Dados inválidos para vincular conta Google Ads ao cliente.",
      };
    }

    const normalizedCustomerId = normalizeGoogleAdsCustomerId(
      parsed.data.externalAccountId
    );
    const normalizedManagerId = parsed.data.managerCustomerId
      ? normalizeGoogleAdsCustomerId(parsed.data.managerCustomerId)
      : null;

    const session = await resolveUnifiedAuthJsPostgresSession();
    const adAccountId = await withTenantTransaction(
      session.context,
      async (tx) => {
        const repo = new PersistentDrizzleTenantRepository(tx);
        const clients = await repo.listClients(session.context);
        const targetClient = clients.find((c) => c.id === parsed.data.clientId);
        if (!targetClient) {
          throw new Error(
            "Cliente informado não encontrado ou sem permissão nesta organização."
          );
        }

        const integrations = await repo.listPublicIntegrations(session.context);
        const targetIntegration = integrations.find(
          (i) => i.id === parsed.data.integrationId
        );
        if (!targetIntegration || targetIntegration.provider !== "GOOGLE_ADS") {
          throw new Error("Integração Google Ads não encontrada.");
        }

        const existing = await tx
          .select()
          .from(schema.adAccounts)
          .where(
            and(
              eq(schema.adAccounts.organizationId, session.context.organizationId),
              eq(schema.adAccounts.provider, "GOOGLE_ADS"),
              eq(schema.adAccounts.externalAccountId, normalizedCustomerId)
            )
          );

        let accountId: string;
        if (existing[0]) {
          accountId = existing[0].id;
          await tx
            .update(schema.adAccounts)
            .set({
              clientId: targetClient.id,
              integrationId: targetIntegration.id,
              name: parsed.data.accountName.trim(),
              managerCustomerId: normalizedManagerId,
              isMccAccount: parsed.data.isMccAccount,
              isSelectedForSync: !parsed.data.isMccAccount,
              currencyCode: parsed.data.currencyCode.toUpperCase(),
              timezone: parsed.data.timezone,
              isDemoData: false,
              updatedAt: new Date(),
            })
            .where(eq(schema.adAccounts.id, accountId));
        } else {
          const [inserted] = await tx
            .insert(schema.adAccounts)
            .values({
              organizationId: session.context.organizationId,
              clientId: targetClient.id,
              integrationId: targetIntegration.id,
              provider: "GOOGLE_ADS",
              externalAccountId: normalizedCustomerId,
              managerCustomerId: normalizedManagerId,
              isMccAccount: parsed.data.isMccAccount,
              isSelectedForSync: !parsed.data.isMccAccount,
              name: parsed.data.accountName.trim(),
              currencyCode: parsed.data.currencyCode.toUpperCase(),
              timezone: parsed.data.timezone,
              isDemoData: false,
            })
            .returning();
          if (!inserted) {
            throw new Error("Falha ao vincular conta Google Ads.");
          }
          accountId = inserted.id;
        }

        await tx.insert(schema.auditLogs).values({
          organizationId: session.context.organizationId,
          actorUserId: session.context.userId,
          actorType: "USER",
          action: "AD_ACCOUNT_BOUND_TO_CLIENT",
          entityType: "ad_account",
          entityId: accountId,
          newState: {
            clientId: targetClient.id,
            externalAccountId: normalizedCustomerId,
            managerCustomerId: normalizedManagerId,
            isMccAccount: parsed.data.isMccAccount,
            currencyCode: parsed.data.currencyCode.toUpperCase(),
            timezone: parsed.data.timezone,
          },
        });

        return accountId;
      }
    );

    revalidatePath("/");
    return { ok: true, adAccountId };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(
        err,
        "Não foi possível vincular a conta Google Ads ao cliente."
      ).publicMessage,
    };
  }
}

function getDefaultDateWindowForTimezone(
  timezone: string,
  days = 7
): { readonly startDate: string; readonly endDate: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const now = new Date();
  const endDate = formatter.format(now);
  const start = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const startDate = formatter.format(start);
  return { startDate, endDate };
}

/**
 * Executes a REAL READ_ONLY Google Ads API v26 synchronization for explicitly bound
 * and selected ad accounts. ZERO synthetic/hardcoded/mock fallbacks.
 */
export async function requestSyncServerAction(
  integrationId: string,
  options?: {
    readonly adAccountId?: string;
    readonly startDate?: string;
    readonly endDate?: string;
  }
): Promise<{
  readonly ok: boolean;
  readonly syncedAccounts?: number;
  readonly error?: string;
}> {
  try {
    const { keyHex, keyVersion } = requireCredentialsEncryptionKey();
    const oauthConfig = requireGoogleAdsOAuthConfig();
    const session = await resolveUnifiedAuthJsPostgresSession();

    const syncedAccounts = await withTenantTransaction(
      session.context,
      async (tx) => {
        const repo = new PersistentDrizzleTenantRepository(tx);
        const integrations = await repo.listPublicIntegrations(session.context);
        const targetIntegration = integrations.find(
          (i) => i.id === integrationId
        );
        if (!targetIntegration) {
          throw new Error("Integração não encontrada na organização ativa.");
        }
        if (targetIntegration.provider !== "GOOGLE_ADS") {
          throw new Error(
            "Sincronização ao vivo suportada atualmente apenas para Google Ads API v26 (READ_ONLY)."
          );
        }
        if (targetIntegration.status !== "CONNECTED") {
          throw new Error(
            "Integração Google Ads não está conectada. Autorize via OAuth 2.0 antes de sincronizar."
          );
        }

        const boundAccounts = await repo.listAdAccounts(session.context);
        const eligibleAccounts = boundAccounts.filter((acc) => {
          if (acc.integrationId !== targetIntegration.id) return false;
          if (options?.adAccountId && acc.id !== options.adAccountId) {
            return false;
          }
          if (!acc.isSelectedForSync || acc.isMccAccount) return false;
          if (!/^\d{10}$/.test(acc.externalAccountId)) return false;
          if (acc.isDemoData) return false;
          return true;
        });

        if (eligibleAccounts.length === 0) {
          throw new Error(
            "Nenhuma conta Google Ads oficial está vinculada explicitamente a um cliente e selecionada para sincronização. Descubra e vincule uma conta real antes de sincronizar."
          );
        }

        const googleService = new PersistentPostgresGoogleAdsService(
          tx,
          keyHex,
          keyVersion
        );
        const adapter = new GoogleAdsLiveSyncAdapter(googleService);
        const syncEngine = new PersistentPostgresAdsSyncEngine(tx);

        for (const account of eligibleAccounts) {
          const range =
            options?.startDate && options?.endDate
              ? validateSyncDateRange({
                  startDate: options.startDate,
                  endDate: options.endDate,
                })
              : getDefaultDateWindowForTimezone(account.timezone, 7);

          const runResult = await syncEngine.executePersistentSync({
            context: session.context,
            integrationId: targetIntegration.id,
            clientId: account.clientId,
            provider: "GOOGLE_ADS",
            fetchBatchFn: async () =>
              await adapter.fetchLiveAccountBatch({
                context: session.context,
                integrationId: targetIntegration.id,
                customerId: account.externalAccountId,
                managerCustomerId: account.managerCustomerId,
                startDate: range.startDate,
                endDate: range.endDate,
                oauthClientId: oauthConfig.clientId,
                oauthClientSecret: oauthConfig.clientSecret,
              }),
          });

          if (runResult.status === "FAILED") {
            throw new Error(
              `Sincronização oficial falhou para a conta ${account.externalAccountId}. Nenhum dado incompleto foi marcado como concluído.`
            );
          }
        }

        return eligibleAccounts.length;
      }
    );

    revalidatePath("/");
    return { ok: true, syncedAccounts };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(
        err,
        "Não foi possível sincronizar os dados reais do Google Ads."
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
      await assertVerifiedOperationalDataForAI(
        tx,
        session.context.organizationId
      );
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
      await assertVerifiedOperationalDataForAI(
        tx,
        session.context.organizationId
      );
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
      await assertVerifiedOperationalDataForAI(
        tx,
        session.context.organizationId
      );
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

