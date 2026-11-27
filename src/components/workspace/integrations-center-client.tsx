"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Plug,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requestSyncServerAction } from "@/app/actions/operational-actions";
import type {
  CommercialIntegrationStatus,
  IntegrationCardItem,
} from "@/application/use-cases/operational-workspace-loader";
import type { SyncRunViewModel } from "@/application/use-cases/dashboard-overview-use-case";

function statusBadgeVariant(
  status: CommercialIntegrationStatus
): "success" | "warning" | "destructive" | "default" | "secondary" {
  switch (status) {
    case "CONECTADO":
      return "success";
    case "SINCRONIZANDO":
      return "default";
    case "AGUARDANDO_AUTORIZACAO":
    case "NAO_CONFIGURADO":
      return "warning";
    case "FALHA":
    case "CREDENCIAL_EXPIRADA":
      return "destructive";
    default:
      return "secondary";
  }
}

export function IntegrationsCenterClient({
  integrationCatalog,
  syncHistory,
}: {
  readonly integrationCatalog: readonly IntegrationCardItem[];
  readonly syncHistory: readonly SyncRunViewModel[];
}) {
  const router = useRouter();
  const [syncingId, setSyncingId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleSyncNow = async (integrationId: string) => {
    setMessage(null);
    setError(null);
    setSyncingId(integrationId);
    try {
      const res = await requestSyncServerAction(integrationId);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível sincronizar.");
        return;
      }
      setMessage(
        "Sincronização incremental READ_ONLY executada e registrada no histórico."
      );
      router.refresh();
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 text-xs flex items-center gap-2.5">
        <ShieldCheck className="h-4 w-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
        <span>
          <strong>Modo Seguro READ_ONLY:</strong> O Konnexy Ads prioriza o
          conector oficial Google Ads API v26 em modo somente leitura. Nenhuma
          alteração real é aplicada automaticamente nas suas campanhas.
        </span>
      </div>

      {message && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
        >
          {message}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {integrationCatalog.map((item) => (
          <Card
            key={item.id}
            data-testid={`integration-card-${item.providerKey}`}
            className="flex flex-col justify-between"
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Plug className="h-4 w-4 text-cyan-500" />
                    {item.name}
                  </CardTitle>
                  <CardDescription>{item.subtitle}</CardDescription>
                </div>
                <Badge variant={statusBadgeVariant(item.status)}>
                  {item.statusLabel}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 text-xs">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-3 space-y-1.5">
                <p className="font-medium text-slate-700 dark:text-slate-300">
                  {item.modeLabel}
                </p>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  {item.detailMessage}
                </p>
                {item.lastSyncedAtIso && (
                  <p className="text-[11px] text-slate-500 flex items-center gap-1 pt-1">
                    <Clock className="h-3 w-3" />
                    Última sincronização:{" "}
                    {new Date(item.lastSyncedAtIso).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {item.providerKey === "GOOGLE_ADS" ? (
                  <>
                    {item.canConnect && item.connectHref ? (
                      <a href={item.connectHref}>
                        <Button type="button" size="sm">
                          <ExternalLink className="h-3.5 w-3.5" />
                          {item.status === "CONECTADO"
                            ? "Reautorizar Google Ads"
                            : "Conectar Google Ads (READ_ONLY)"}
                        </Button>
                      </a>
                    ) : (
                      <Button type="button" size="sm" disabled>
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Aguardando credenciais OAuth na Vercel
                      </Button>
                    )}

                    {item.status === "CONECTADO" && item.integrationId && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={syncingId === item.integrationId}
                        onClick={() => handleSyncNow(item.integrationId!)}
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${
                            syncingId === item.integrationId
                              ? "animate-spin"
                              : ""
                          }`}
                        />
                        {syncingId === item.integrationId
                          ? "Sincronizando..."
                          : "Sincronizar Agora"}
                      </Button>
                    )}
                  </>
                ) : (
                  <Button type="button" size="sm" variant="outline" disabled>
                    Em desenvolvimento — indisponível
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Sync History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Histórico de Sincronizações ({syncHistory.length})
          </CardTitle>
          <CardDescription>
            Registro persistente das coletas incrementais executadas nas contas
            conectadas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {syncHistory.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Nenhuma sincronização executada até o momento.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-500">
                    <th className="py-2 pr-3">Plataforma</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Início</th>
                    <th className="py-2 pr-3">Conclusão</th>
                  </tr>
                </thead>
                <tbody>
                  {syncHistory.map((run) => (
                    <tr
                      key={run.id}
                      className="border-b border-slate-100 dark:border-slate-800/60"
                    >
                      <td className="py-2 pr-3 font-medium">{run.provider}</td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant={
                            run.status === "COMPLETED"
                              ? "success"
                              : run.status === "FAILED"
                                ? "destructive"
                                : "default"
                          }
                        >
                          {run.status === "COMPLETED" && (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          {run.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">
                        {new Date(run.startedAtIso).toLocaleString("pt-BR")}
                      </td>
                      <td className="py-2 pr-3">
                        {run.completedAtIso
                          ? new Date(run.completedAtIso).toLocaleString("pt-BR")
                          : "Em andamento"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
