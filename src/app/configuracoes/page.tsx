import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { SettingsHubClient } from "@/components/workspace/settings-hub-client";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const ws = await requireOperationalWorkspace();
  return (
    <CommercialAppShell
      pageTitle="Configurações"
      pageSubtitle="Gerencie perfil da organização, equipe, trava de segurança e diagnósticos administrativos."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <SettingsHubClient
        organizationId={ws.organizationId}
        organizationName={ws.organizationName}
        organizationSlug={ws.organizationSlug}
        organizationTimezone={ws.organizationTimezone}
        organizationCurrency={ws.organizationCurrency}
        emergencyStopActive={ws.emergencyStopActive}
        authenticatedUserRole={ws.authenticatedUserRole}
        members={ws.members}
        auditTrail={ws.auditTrail}
        domainTables={ws.domainTables}
      />
    </CommercialAppShell>
  );
}
