import { notFound } from "next/navigation";
import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { PrintableReportView } from "@/components/workspace/printable-report-view";

export const dynamic = "force-dynamic";

export default async function ImprimirRelatorioPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ws = await requireOperationalWorkspace();
  const report = ws.executiveReports.find((r) => r.id === id);

  if (!report) {
    notFound();
  }

  const client = ws.clients.find((c) => c.id === report.clientId);

  return (
    <PrintableReportView
      report={report}
      organizationName={ws.organizationName}
      clientName={client?.name ?? "Cliente"}
      dailyMetrics={ws.dailyMetrics}
      kpiSummary={ws.kpiSummary}
      recentActions={ws.auditTrail}
    />
  );
}
