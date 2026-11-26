import { getDashboardOverviewUseCase } from "@/application/use-cases/dashboard-overview-use-case";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export const dynamic = "force-dynamic";

/**
 * Isolated Public Demonstration Environment (`/demo`).
 * Separated from the authenticated operational environment (`/`) and has zero access
 * to real tenant data in PostgreSQL.
 */
export default async function PublicDemoPage() {
  const vm = await getDashboardOverviewUseCase();

  return (
    <DashboardShell
      organizationName={vm.organizationName}
      organizationId={vm.organizationId}
      organizations={vm.organizations.filter((o) => o.isDemo)}
      clients={vm.clients}
      adAccounts={vm.adAccounts}
      members={vm.members}
      integrations={vm.integrations}
      campaigns={vm.campaigns}
      dailyMetrics={vm.dailyMetrics}
      recommendations={vm.recommendations}
      domainTables={vm.domainTables}
    />
  );
}
