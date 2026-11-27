import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { OverviewDashboardClient } from "@/components/workspace/overview-dashboard-client";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    clientId?: string;
    adAccountId?: string;
    campaignId?: string;
    periodDays?: string;
  }>;
}) {
  const sp = await searchParams;
  const periodDays = Number(sp.periodDays) || 30;

  const ws = await requireOperationalWorkspace({
    clientId: sp.clientId || undefined,
    adAccountId: sp.adAccountId || undefined,
    campaignId: sp.campaignId || undefined,
    periodDays,
  });

  return (
    <CommercialAppShell
      pageTitle="Visão Geral"
      pageSubtitle="Acompanhe investimentos, conversões, metas e próximos passos da operação."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <OverviewDashboardClient
        clients={ws.clients}
        adAccounts={ws.adAccounts}
        campaigns={ws.campaigns}
        dailyMetrics={ws.dailyMetrics}
        kpiSummary={ws.kpiSummary}
        onboardingChecklist={ws.onboardingChecklist}
        executiveReports={ws.executiveReports}
        initialFilters={{
          clientId: sp.clientId ?? "",
          adAccountId: sp.adAccountId ?? "",
          campaignId: sp.campaignId ?? "",
          periodDays,
        }}
      />
    </CommercialAppShell>
  );
}
