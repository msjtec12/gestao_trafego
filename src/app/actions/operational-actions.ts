"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOperationalPostgresRuntime } from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";
import {
  authenticateUserWithPostgres,
  onboardFirstOrganizationRepository,
  PersistentDrizzleTenantRepository,
  resolveSessionFromPostgres,
  revokeSessionInPostgres,
  switchActiveOrganizationInPostgres,
} from "@/infrastructure/db/repositories/drizzle-tenant-repositories";
import { PersistentPostgresGoogleAdsService } from "@/integrations/google-ads/google-ads-oauth-and-readonly";
import { PersistentPostgresAdsSyncEngine } from "@/workflows/incremental-sync-engine";
import { toPublicSafeErrorMessage } from "@/security/public-errors";

const SESSION_COOKIE_NAME = "konnexy_session";

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

function getVaultKey(): string {
  const envKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (
    envKey &&
    /^[0-9a-fA-F]{64}$/.test(envKey) &&
    new Set(envKey.toLowerCase()).size >= 4
  ) {
    return envKey;
  }
  return "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
}

export async function loginUserAction(rawInput: {
  readonly email: string;
  readonly password: string;
}): Promise<{ readonly ok: boolean; readonly error?: string }> {
  try {
    const parsed = LoginInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Credenciais inválidas.",
      };
    }

    const { db } = await getOperationalPostgresRuntime();
    const session = await authenticateUserWithPostgres(db, parsed.data);

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, session.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });

    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(err, "E-mail ou senha inválidos.")
        .publicMessage,
    };
  }
}

export async function onboardOrganizationAction(rawInput: {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
}): Promise<{ readonly ok: boolean; readonly error?: string }> {
  try {
    const { db } = await getOperationalPostgresRuntime();
    const result = await onboardFirstOrganizationRepository(db, {
      ...rawInput,
      timezone: "America/Sao_Paulo",
      currencyCode: "BRL",
    });

    // Also create a default Google Ads integration placeholder in BLOCKED/DISCONNECTED state
    // and a sandbox Mock integration for optional testing
    await db.insert(schema.integrations).values({
      organizationId: result.organization.id,
      provider: "GOOGLE_ADS",
      externalAccountLabel: "Google Ads API v26 (OAuth 2.0 Read-Only)",
      status: "ERROR",
      isDemoIntegration: false,
    });

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });

    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: toPublicSafeErrorMessage(
        err,
        "Não foi possível concluir o onboarding."
      ).publicMessage,
    };
  }
}

export async function logoutUserAction(): Promise<{ readonly ok: boolean }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const { db } = await getOperationalPostgresRuntime();
    await revokeSessionInPostgres(db, token);
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
  revalidatePath("/");
  return { ok: true };
}

export async function switchOrganizationAction(
  targetOrganizationId: string
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const { db } = await getOperationalPostgresRuntime();
    await switchActiveOrganizationInPostgres(db, {
      sessionToken: token ?? "",
      targetOrganizationId,
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

export async function createClientServerAction(rawInput: {
  readonly name: string;
  readonly industry: string;
  readonly monthlyBudgetCapBrl: number | string;
  readonly targetCpaBrl: number | string;
}): Promise<{
  readonly ok: boolean;
  readonly error?: string;
  readonly clientId?: string;
}> {
  try {
    const parsed = ClientCreateSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Dados do cliente inválidos.",
      };
    }

    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const { db } = await getOperationalPostgresRuntime();
    const session = await resolveSessionFromPostgres(db, {
      sessionToken: token,
    });

    const repo = new PersistentDrizzleTenantRepository(db);
    const created = await repo.createClient(session.context, {
      name: parsed.data.name,
      industry: parsed.data.industry,
      monthlyBudgetCapCents: Math.round(
        parsed.data.monthlyBudgetCapBrl * 100
      ),
      targetCpaCents: Math.round(parsed.data.targetCpaBrl * 100),
    });

    revalidatePath("/");
    return { ok: true, clientId: created.id };
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

    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const { db } = await getOperationalPostgresRuntime();
    const session = await resolveSessionFromPostgres(db, {
      sessionToken: token,
    });

    const repo = new PersistentDrizzleTenantRepository(db);
    await repo.updateClient(session.context, {
      clientId: parsed.data.clientId,
      name: parsed.data.name,
      industry: parsed.data.industry,
      monthlyBudgetCapCents: Math.round(
        parsed.data.monthlyBudgetCapBrl * 100
      ),
      targetCpaCents: Math.round(parsed.data.targetCpaBrl * 100),
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
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const { db } = await getOperationalPostgresRuntime();
    const session = await resolveSessionFromPostgres(db, {
      sessionToken: token,
    });

    const repo = new PersistentDrizzleTenantRepository(db);
    await repo.deactivateClient(session.context, clientId);

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
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const { db } = await getOperationalPostgresRuntime();
    const session = await resolveSessionFromPostgres(db, {
      sessionToken: token,
    });

    const repo = new PersistentDrizzleTenantRepository(db);
    await repo.toggleAdAccountSyncSelection(session.context, adAccountId);

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
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const { db } = await getOperationalPostgresRuntime();
    const session = await resolveSessionFromPostgres(db, {
      sessionToken: token,
    });

    const googleService = new PersistentPostgresGoogleAdsService(
      db,
      getVaultKey()
    );
    await googleService.revokeIntegrationInPostgres({
      context: session.context,
      integrationId,
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
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const { db } = await getOperationalPostgresRuntime();
    const session = await resolveSessionFromPostgres(db, {
      sessionToken: token,
    });

    const repo = new PersistentDrizzleTenantRepository(db);
    const currentOrg = await repo.getOrganization(session.context);
    const nextState = !currentOrg.emergencyStopActive;
    const updated = await repo.updateOrganizationSettings(session.context, {
      emergencyStopActive: nextState,
      emergencyStopReason: nextState
        ? "Acionado pelo operador no Command Center"
        : null,
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
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const { db } = await getOperationalPostgresRuntime();
    const session = await resolveSessionFromPostgres(db, {
      sessionToken: token,
    });

    const repo = new PersistentDrizzleTenantRepository(db);
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
        db,
        getVaultKey()
      );
      // Will throw AUTH_TOKEN_REVOKED or missing token if no real OAuth credentials exist
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

    const syncEngine = new PersistentPostgresAdsSyncEngine(db);
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
