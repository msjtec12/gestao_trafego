import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { CommercialAICenterClient } from "@/components/workspace/commercial-ai-center-client";

export const dynamic = "force-dynamic";

export default async function RecomendacoesPage() {
  const ws = await requireOperationalWorkspace();
  return (
    <CommercialAppShell
      pageTitle="Recomendações"
      pageSubtitle="Revise, aprove ou rejeite recomendações com evidências reais e nível de risco."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <CommercialAICenterClient
        clients={ws.clients}
        recommendations={ws.persistedRecommendations}
        mode="RECOMMENDATIONS"
      />
    </CommercialAppShell>
  );
}
