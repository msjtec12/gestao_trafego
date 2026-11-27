import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { AutomationsView } from "@/components/workspace/operational-domain-views";

export const dynamic = "force-dynamic";

export default async function AutomacoesPage() {
  const ws = await requireOperationalWorkspace();
  return (
    <CommercialAppShell
      pageTitle="Automações"
      pageSubtitle="Acompanhe regras de proteção, simulações e governança em modo READ_ONLY."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <AutomationsView rules={ws.automationRules} runs={ws.automationRuns} />
    </CommercialAppShell>
  );
}
