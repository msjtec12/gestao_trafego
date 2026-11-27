import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { ConversionsView } from "@/components/workspace/operational-domain-views";

export const dynamic = "force-dynamic";

export default async function ConversoesPage() {
  const ws = await requireOperationalWorkspace();
  return (
    <CommercialAppShell
      pageTitle="Conversões"
      pageSubtitle="Monitore metas primárias, modelos de atribuição e saúde do rastreamento."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <ConversionsView rows={ws.conversions} />
    </CommercialAppShell>
  );
}
