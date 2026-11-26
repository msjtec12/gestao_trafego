import { getDashboardOverviewUseCase } from "@/application/use-cases/dashboard-overview-use-case";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default async function HomePage() {
  const vm = await getDashboardOverviewUseCase();

  return (
    <DashboardShell
      organizationName={vm.organizationName}
      organizationId={vm.organizationId}
      campaigns={vm.campaigns}
      dailyMetrics={vm.dailyMetrics}
      recommendations={vm.recommendations}
      domainTables={vm.domainTables}
    />
  );
}
