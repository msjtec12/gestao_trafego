import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { AdGroupsView } from "@/components/workspace/operational-domain-views";

export const dynamic = "force-dynamic";

export default async function GruposDeAnunciosPage() {
  const ws = await requireOperationalWorkspace();
  return (
    <CommercialAppShell
      pageTitle="Grupos de Anúncios"
      pageSubtitle="Visualize estrutura de grupos e lances CPC padrão sincronizados."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <AdGroupsView rows={ws.adGroups} />
    </CommercialAppShell>
  );
}
