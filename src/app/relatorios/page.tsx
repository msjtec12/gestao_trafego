import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { CommercialReportsClient } from "@/components/workspace/commercial-reports-client";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  const ws = await requireOperationalWorkspace();
  return (
    <CommercialAppShell
      pageTitle="Relatórios"
      pageSubtitle="Gere relatórios executivos comerciais por cliente com identidade visual Konnexy e exportação em PDF."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <CommercialReportsClient
        clients={ws.clients}
        reports={ws.executiveReports}
      />
    </CommercialAppShell>
  );
}
