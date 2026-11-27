import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedOperationalDashboardUseCase } from "@/application/use-cases/dashboard-overview-use-case";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { AUTHJS_SESSION_COOKIE_NAME } from "@/middleware";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  readonly searchParams?: Promise<{
    googleAdsStatus?: string;
    googleAdsCode?: string;
    googleAdsMessage?: string;
  }>;
}) {
  const sp = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const sessionToken =
    cookieStore.get(AUTHJS_SESSION_COOKIE_NAME)?.value ??
    cookieStore.get(`__Secure-${AUTHJS_SESSION_COOKIE_NAME}`)?.value;

  if (!sessionToken) {
    redirect("/login");
  }

  let vm;
  try {
    vm = await getAuthenticatedOperationalDashboardUseCase({
      sessionToken,
    });
  } catch {
    redirect("/login");
  }

  const googleAdsNotice =
    sp.googleAdsStatus === "connected" || sp.googleAdsStatus === "error"
      ? {
          status: sp.googleAdsStatus as "connected" | "error",
          code: sp.googleAdsCode ?? null,
          message:
            sp.googleAdsMessage ??
            (sp.googleAdsStatus === "connected"
              ? "Google Ads conectado com sucesso em modo READ_ONLY."
              : "Não foi possível concluir a autorização do Google Ads."),
        }
      : null;

  return (
    <DashboardShell
      organizationName={vm.organizationName}
      organizationId={vm.organizationId}
      authenticatedUserEmail={vm.authenticatedUserEmail}
      isDemoEnvironment={false}
      emergencyStopActive={vm.emergencyStopActive}
      organizations={vm.organizations}
      clients={vm.clients}
      adAccounts={vm.adAccounts}
      members={vm.members}
      integrations={vm.integrations}
      googleAdsConfigStatus={vm.googleAdsConfigStatus}
      googleAdsNotice={googleAdsNotice}
      dataIntegrity={vm.dataIntegrity}
      syncHistory={vm.syncHistory}
      auditTrail={vm.auditTrail}
      campaigns={vm.campaigns}
      dailyMetrics={vm.dailyMetrics}
      recommendations={vm.recommendations}
      persistedRecommendations={vm.persistedRecommendations}
      executiveReports={vm.executiveReports}
      domainTables={vm.domainTables}
    />
  );
}
