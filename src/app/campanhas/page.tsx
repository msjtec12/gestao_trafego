import { requireOperationalWorkspace } from "@/application/use-cases/operational-workspace-loader";
import { CommercialAppShell } from "@/components/workspace/commercial-app-shell";
import { CampaignsTable } from "@/components/dashboard/campaigns-table";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CampanhasPage() {
  const ws = await requireOperationalWorkspace();

  return (
    <CommercialAppShell
      pageTitle="Campanhas"
      pageSubtitle="Acompanhe desempenho, verba diária, CPA e ROAS de todas as campanhas sincronizadas."
      organizationId={ws.organizationId}
      organizationName={ws.organizationName}
      organizations={ws.organizations}
      authenticatedUserEmail={ws.authenticatedUserEmail}
      emergencyStopActive={ws.emergencyStopActive}
    >
      {ws.campaigns.length > 0 ? (
        <CampaignsTable campaigns={ws.campaigns} />
      ) : (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <p className="text-sm font-semibold">
              Nenhuma campanha sincronizada ainda
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Conecte uma conta Google Ads em modo somente leitura e execute a
              primeira sincronização para visualizar suas campanhas reais aqui.
            </p>
            <Link
              href="/integracoes"
              className="inline-block text-xs font-semibold text-cyan-600 dark:text-cyan-400 hover:underline pt-1"
            >
              Ir para Central de Integrações →
            </Link>
          </CardContent>
        </Card>
      )}
    </CommercialAppShell>
  );
}
