import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { KeywordsView } from "@/components/workspace/operational-domain-views";

export const dynamic = "force-dynamic";

export default async function PalavrasChavePage() {
  const ws = await requireOperationalWorkspace();
  return (
    <CommercialAppShell
      pageTitle="Palavras-chave"
      pageSubtitle="Acompanhe correspondências, lances e índice de qualidade."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <KeywordsView rows={ws.keywords} />
    </CommercialAppShell>
  );
}
