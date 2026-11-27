import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { AdsView } from "@/components/workspace/operational-domain-views";

export const dynamic = "force-dynamic";

export default async function AnunciosPage() {
  const ws = await requireOperationalWorkspace();
  return (
    <CommercialAppShell
      pageTitle="Anúncios"
      pageSubtitle="Audite títulos, descrições, URLs finais e aprovação de políticas."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <AdsView rows={ws.ads} />
    </CommercialAppShell>
  );
}
