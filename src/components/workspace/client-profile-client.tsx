"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Save,
  Link2,
  Sparkles,
  FileBarChart2,
  History,
  TrendingUp,
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
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import { updateClientServerAction } from "@/app/actions/operational-actions";
import type { CommercialClientViewModel } from "@/application/use-cases/operational-workspace-loader";
import type {
  AdAccountRecordViewModel,
  AuditEventViewModel,
} from "@/application/use-cases/dashboard-overview-use-case";
import type { NormalizedDailyMetric } from "@/integrations/contracts/advertising-provider";
import type {
  PersistedExecutiveReport,
  PersistedRecommendationWithApproval,
} from "@/infrastructure/db/repositories/ai-recommendations-reports-repository";

export function ClientProfileClient({
  client,
  adAccounts,
  dailyMetrics,
  recommendations,
  reports,
  optimizationHistory,
}: {
  readonly client: CommercialClientViewModel;
  readonly adAccounts: readonly AdAccountRecordViewModel[];
  readonly dailyMetrics: NormalizedDailyMetric[];
  readonly recommendations: readonly PersistedRecommendationWithApproval[];
  readonly reports: readonly PersistedExecutiveReport[];
  readonly optimizationHistory: readonly AuditEventViewModel[];
}) {
  const router = useRouter();
  const [name, setName] = React.useState(client.name);
  const [industry, setIndustry] = React.useState(client.industry);
  const [websiteUrl, setWebsiteUrl] = React.useState(client.websiteUrl ?? "");
  const [monthlyBudgetCapBrl, setMonthlyBudgetCapBrl] = React.useState(
    String(client.monthlyBudgetCapBrl)
  );
  const [targetCpaBrl, setTargetCpaBrl] = React.useState(
    client.targetCpaBrl !== null ? String(client.targetCpaBrl) : ""
  );
  const [targetRoas, setTargetRoas] = React.useState(
    client.targetRoas !== null ? String(client.targetRoas) : ""
  );
  const [saving, setSaving] = React.useState(false);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess(null);
    setError(null);
    setSaving(true);
    try {
      const res = await updateClientServerAction({
        clientId: client.id,
        name,
        industry,
        websiteUrl: websiteUrl.trim() || undefined,
        monthlyBudgetCapBrl,
        targetCpaBrl,
        targetRoas: targetRoas.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível atualizar o cliente.");
        return;
      }
      setSuccess("Dados comerciais do cliente atualizados no PostgreSQL.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/clientes"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para carteira de clientes
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/ia">
            <Button size="sm" variant="outline">
              <Sparkles className="h-3.5 w-3.5" />
              Analisar com IA
            </Button>
          </Link>
          <Link href="/relatorios">
            <Button size="sm">
              <FileBarChart2 className="h-3.5 w-3.5" />
              Gerar Relatório
            </Button>
          </Link>
        </div>
      </div>

      {/* Commercial Registration & Goals */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Dados Cadastrais, Objetivos Comerciais e Metas
          </CardTitle>
          <CardDescription>
            Todas as alterações são persistidas com histórico de auditoria no
            Neon PostgreSQL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {success && (
            <div
              role="status"
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
            >
              {success}
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

          <form
            onSubmit={handleSave}
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
          >
            <div>
              <label
                htmlFor="edit-cli-name"
                className="block text-xs font-medium mb-1"
              >
                Nome do Cliente
              </label>
              <input
                id="edit-cli-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="edit-cli-industry"
                className="block text-xs font-medium mb-1"
              >
                Segmento / Objetivo Principal
              </label>
              <input
                id="edit-cli-industry"
                type="text"
                required
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="edit-cli-website"
                className="block text-xs font-medium mb-1"
              >
                Site / Landing Page Oficial
              </label>
              <input
                id="edit-cli-website"
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://cliente.com.br"
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="edit-cli-budget"
                className="block text-xs font-medium mb-1"
              >
                Orçamento Mensal (R$)
              </label>
              <input
                id="edit-cli-budget"
                type="number"
                required
                min="1"
                step="0.01"
                value={monthlyBudgetCapBrl}
                onChange={(e) => setMonthlyBudgetCapBrl(e.target.value)}
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="edit-cli-cpa"
                className="block text-xs font-medium mb-1"
              >
                CPA Desejado (R$)
              </label>
              <input
                id="edit-cli-cpa"
                type="number"
                required
                min="1"
                step="0.01"
                value={targetCpaBrl}
                onChange={(e) => setTargetCpaBrl(e.target.value)}
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="edit-cli-roas"
                className="block text-xs font-medium mb-1"
              >
                ROAS Desejado (quando aplicável)
              </label>
              <input
                id="edit-cli-roas"
                type="number"
                min="0.1"
                step="0.1"
                value={targetRoas}
                onChange={(e) => setTargetRoas(e.target.value)}
                placeholder="Ex.: 4.0"
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>

            <div className="md:col-span-3">
              <Button type="submit" disabled={saving}>
                <Save className="h-4 w-4" />
                {saving ? "Salvando..." : "Salvar Alterações"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Performance History */}
      {dailyMetrics.length > 0 ? (
        <PerformanceChart metrics={dailyMetrics} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-cyan-500" />
              Histórico de Desempenho
            </CardTitle>
            <CardDescription>
              Nenhuma métrica diária sincronizada para este cliente ainda.
              Vincule uma conta Google Ads em{" "}
              <Link
                href="/integracoes"
                className="text-cyan-600 dark:text-cyan-400 underline"
              >
                Integrações
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Linked Ad Accounts, Recommendations, Reports, Optimization History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="h-4 w-4 text-cyan-500" />
              Contas de Anúncios Vinculadas ({adAccounts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {adAccounts.length === 0 ? (
              <p className="text-slate-500 dark:text-slate-400">
                Nenhuma conta vinculada. Acesse{" "}
                <Link
                  href="/integracoes"
                  className="text-cyan-600 dark:text-cyan-400 underline"
                >
                  Integrações
                </Link>{" "}
                para conectar o Google Ads.
              </p>
            ) : (
              adAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="font-semibold">{acc.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      ID: {acc.externalAccountId} · {acc.currencyCode}
                    </p>
                  </div>
                  <Badge variant={acc.isSelectedForSync ? "success" : "secondary"}>
                    {acc.isSelectedForSync ? "Sincronizando" : "Inativa"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-500" />
              Recomendações Ativas ({recommendations.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {recommendations.length === 0 ? (
              <p className="text-slate-500 dark:text-slate-400">
                Nenhuma recomendação gerada para este cliente ainda.
              </p>
            ) : (
              recommendations.slice(0, 5).map((rec) => (
                <div
                  key={rec.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{rec.title}</p>
                    <Badge variant="secondary">{rec.status}</Badge>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400">
                    {rec.diagnosis}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileBarChart2 className="h-4 w-4 text-cyan-500" />
              Relatórios do Cliente ({reports.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {reports.length === 0 ? (
              <p className="text-slate-500 dark:text-slate-400">
                Nenhum relatório gerado para este cliente ainda.
              </p>
            ) : (
              reports.map((rep) => (
                <div
                  key={rep.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="font-semibold">{rep.title}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {rep.periodStart} a {rep.periodEnd}
                    </p>
                  </div>
                  <Link
                    href={`/relatorios/${rep.id}/imprimir`}
                    className="text-cyan-600 dark:text-cyan-400 font-medium hover:underline"
                  >
                    Exportar PDF
                  </Link>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-cyan-500" />
              Histórico de Otimizações & Auditoria ({optimizationHistory.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {optimizationHistory.length === 0 ? (
              <p className="text-slate-500 dark:text-slate-400">
                Nenhuma otimização ou alteração registrada para este cliente.
              </p>
            ) : (
              optimizationHistory.slice(0, 8).map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 flex items-center justify-between gap-2"
                >
                  <div>
                    <p className="font-medium">{ev.action}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {new Date(ev.timestamp).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <Badge variant="secondary">{ev.entityType}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
