import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { CommercialAICenterClient } from "@/components/workspace/commercial-ai-center-client";

export const dynamic = "force-dynamic";

export default async function CentralDeIAPage() {
  const ws = await requireOperationalWorkspace();
  return (
    <CommercialAppShell
      pageTitle="Central de Inteligência Artificial"
      pageSubtitle="Análises comerciais de desempenho, palavras-chave, orçamento, conversões, estratégia, landing pages e anúncios."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <CommercialAICenterClient
        clients={ws.clients}
        recommendations={ws.persistedRecommendations}
        mode="AI_CENTER"
      />
    </CommercialAppShell>
  );
}
