import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { SearchTermsView } from "@/components/workspace/operational-domain-views";

export const dynamic = "force-dynamic";

export default async function TermosDePesquisaPage() {
  const ws = await requireOperationalWorkspace();
  return (
    <CommercialAppShell
      pageTitle="Termos de Pesquisa"
      pageSubtitle="Identifique buscas reais com desperdício de verba ou potencial de conversão."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      <SearchTermsView rows={ws.searchTerms} />
    </CommercialAppShell>
  );
}
