import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { BudgetsView } from "@/components/workspace/operational-domain-views";

export const dynamic = "force-dynamic";

export default async function OrcamentosPage() {
  const ws = await requireOperationalWorkspace();
  return (
    <CommercialAppShell
      pageTitle="Orçamentos"
      pageSubtitle="Controle tetos mensais, metas de CPA/ROAS e ritmo de consumo por cliente."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <BudgetsView budgets={ws.budgets} clients={ws.clients} />
    </CommercialAppShell>
  );
}
