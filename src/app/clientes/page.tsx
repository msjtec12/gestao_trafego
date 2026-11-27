import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { ClientsPortfolioClient } from "@/components/workspace/clients-portfolio-client";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const ws = await requireOperationalWorkspace();

  return (
    <CommercialAppShell
      pageTitle="Clientes"
      pageSubtitle="Gerencie sua carteira comercial, orçamentos mensais e metas de CPA/ROAS."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <ClientsPortfolioClient
        clients={ws.clients}
        adAccounts={ws.adAccounts}
      />
    </CommercialAppShell>
  );
}
