import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { IntegrationsCenterClient } from "@/components/workspace/integrations-center-client";

export const dynamic = "force-dynamic";

export default async function IntegracoesPage() {
  const ws = await requireOperationalWorkspace();

  return (
    <CommercialAppShell
      pageTitle="Integrações"
      pageSubtitle="Conecte plataformas de anúncios e acompanhe o status real de cada conector."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <IntegrationsCenterClient
        integrationCatalog={ws.integrationCatalog}
        syncHistory={ws.syncHistory}
      />
    </CommercialAppShell>
  );
}
