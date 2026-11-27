import { notFound } from "next/navigation";
import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { ClientProfileClient } from "@/components/workspace/client-profile-client";

export const dynamic = "force-dynamic";

export default async function ClienteDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ws = await requireOperationalWorkspace({ clientId: id });
  const client = ws.clients.find((c) => c.id === id);

  if (!client) {
    notFound();
  }

  const clientAudit = ws.auditTrail.filter(
    (ev) => ev.entityId === client.id || ev.detail.includes(client.id)
  );

  return (
    <CommercialAppShell
      pageTitle={client.name}
      pageSubtitle={`Perfil comercial · ${client.industry}`}
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <ClientProfileClient
        client={client}
        adAccounts={ws.adAccounts.filter((a) => a.clientId === client.id)}
        dailyMetrics={ws.dailyMetrics}
        recommendations={ws.persistedRecommendations}
        reports={ws.executiveReports}
        optimizationHistory={clientAudit}
      />
    </CommercialAppShell>
  );
}
