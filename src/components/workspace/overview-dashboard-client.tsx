"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Eye,
  MousePointerClick,
  Percent,
  Target,
  Wallet,
  Sparkles,
  FileBarChart2,
  Plus,
  ArrowUpRight,
  Building2,
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
import { CampaignsTable } from "@/components/dashboard/campaigns-table";
import { GuidedOnboardingChecklist } from "./guided-onboarding-checklist";
import {
  createClientServerAction,
  generateExecutiveReportServerAction,
} from "@/app/actions/operational-actions";
import type {
  CommercialClientViewModel,
  GuidedOnboardingStep,
  PeriodKpiSummary,
} from "@/application/use-cases/operational-workspace-loader";
import type { AdAccountRecordViewModel } from "@/application/use-cases/dashboard-overview-use-case";
import type {
  NormalizedCampaign,
  NormalizedDailyMetric,
} from "@/integrations/contracts/advertising-provider";
import type { PersistedExecutiveReport } from "@/infrastructure/db/repositories/ai-recommendations-reports-repository";

function formatBrl(value: number | null): string {
  if (value === null) return "Sem dados";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function DeltaBadge({ deltaPct }: { readonly deltaPct: number | null }) {
  if (deltaPct === null) {
    return (
      <span className="text-[11px] text-slate-500 dark:text-slate-400">
        Sem base anterior
      </span>
    );
  }
  const positive = deltaPct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
        positive
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-amber-600 dark:text-amber-400"
      }`}
    >
      {positive ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {positive ? "+" : ""}
      {deltaPct}% vs período anterior
    </span>
  );
}

export interface OverviewDashboardClientProps {
  readonly clients: readonly CommercialClientViewModel[];
  readonly adAccounts: readonly AdAccountRecordViewModel[];
  readonly campaigns: NormalizedCampaign[];
  readonly dailyMetrics: NormalizedDailyMetric[];
  readonly kpiSummary: PeriodKpiSummary;
  readonly onboardingChecklist: readonly GuidedOnboardingStep[];
  readonly executiveReports: readonly PersistedExecutiveReport[];
  readonly initialFilters: {
    readonly clientId: string;
    readonly adAccountId: string;
    readonly campaignId: string;
    readonly periodDays: number;
  };
}

export function OverviewDashboardClient({
  clients: initialClients,
  adAccounts,
  campaigns,
  dailyMetrics,
  kpiSummary,
  onboardingChecklist,
  executiveReports: initialReports,
  initialFilters,
}: OverviewDashboardClientProps) {
  const router = useRouter();
  const [clients, setClients] =
    React.useState<readonly CommercialClientViewModel[]>(initialClients);
  const [reports, setReports] =
    React.useState<readonly PersistedExecutiveReport[]>(initialReports);

  // Filters synced to URL query params so KPIs, charts, and tables stay 100% consistent
  const [clientId, setClientId] = React.useState(initialFilters.clientId);
  const [adAccountId, setAdAccountId] = React.useState(
    initialFilters.adAccountId
  );
  const [campaignId, setCampaignId] = React.useState(initialFilters.campaignId);
  const [periodDays, setPeriodDays] = React.useState(initialFilters.periodDays);

  // Quick client creation state (persisted in Neon PostgreSQL)
  const [clientName, setClientName] = React.useState("");
  const [clientIndustry, setClientIndustry] = React.useState("");
  const [clientBudget, setClientBudget] = React.useState("");
  const [clientTargetCpa, setClientTargetCpa] = React.useState("");
  const [creatingClient, setCreatingClient] = React.useState(false);
  const [clientSuccess, setClientSuccess] = React.useState<string | null>(null);
  const [clientError, setClientError] = React.useState<string | null>(null);

  // Quick executive report generation state
  const [generatingReport, setGeneratingReport] = React.useState(false);
  const [reportSuccess, setReportSuccess] = React.useState<string | null>(null);
  const [reportError, setReportError] = React.useState<string | null>(null);

  const applyFilters = (next: {
    clientId?: string;
    adAccountId?: string;
    campaignId?: string;
    periodDays?: number;
  }) => {
    const cId = next.clientId ?? clientId;
    const aId = next.adAccountId ?? adAccountId;
    const campId = next.campaignId ?? campaignId;
    const pDays = next.periodDays ?? periodDays;

    setClientId(cId);
    setAdAccountId(aId);
    setCampaignId(campId);
    setPeriodDays(pDays);

    const qs = new URLSearchParams();
    if (cId) qs.set("clientId", cId);
    if (aId) qs.set("adAccountId", aId);
    if (campId) qs.set("campaignId", campId);
    if (pDays !== 30) qs.set("periodDays", String(pDays));
    const query = qs.toString();
    router.push(query ? `/?${query}` : "/");
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);
    setClientSuccess(null);
    setCreatingClient(true);
    try {
      const res = await createClientServerAction({
        name: clientName,
        industry: clientIndustry,
        monthlyBudgetCapBrl: clientBudget,
        targetCpaBrl: clientTargetCpa,
      });
      if (!res.ok || !res.client) {
        setClientError(res.error ?? "Não foi possível cadastrar o cliente.");
        return;
      }
      const created: CommercialClientViewModel = {
        ...res.client,
        createdAtIso: new Date().toISOString(),
      };
      setClients((prev) => [created, ...prev]);
      setClientName("");
      setClientIndustry("");
      setClientBudget("");
      setClientTargetCpa("");
      setClientSuccess(`Cliente "${created.name}" cadastrado com sucesso.`);
      router.refresh();
    } finally {
      setCreatingClient(false);
    }
  };

  const handleGenerateReport = async () => {
    setReportError(null);
    setReportSuccess(null);
    const targetClient =
      clients.find((c) => c.id === clientId) ?? clients[0];
    if (!targetClient) {
      setReportError("Cadastre um cliente antes de gerar um relatório.");
      return;
    }
    setGeneratingReport(true);
    try {
      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setUTCDate(endDate.getUTCDate() - periodDays);
      const res = await generateExecutiveReportServerAction({
        clientId: targetClient.id,
        periodStart: startDate.toISOString().slice(0, 10),
        periodEnd: endDate.toISOString().slice(0, 10),
      });
      if (!res.ok || !res.report) {
        setReportError(res.error ?? "Não foi possível gerar o relatório.");
        return;
      }
      setReports((prev) => [res.report!, ...prev]);
      setReportSuccess(
        `Relatório executivo gerado para ${targetClient.name}.`
      );
      router.refresh();
    } finally {
      setGeneratingReport(false);
    }
  };

  const filteredAccounts = clientId
    ? adAccounts.filter((a) => a.clientId === clientId)
    : adAccounts;

  return (
    <div className="space-y-6">
      {/* Guided 9-Step Onboarding Checklist */}
      <GuidedOnboardingChecklist steps={onboardingChecklist} />

      {/* Professional Filters Bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label
                htmlFor="overview-client-filter"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Cliente
              </label>
              <select
                id="overview-client-filter"
                data-testid="client-selector"
                value={clientId}
                onChange={(e) =>
                  applyFilters({
                    clientId: e.target.value,
                    adAccountId: "",
                    campaignId: "",
                  })
                }
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              >
                <option value="">Todos os clientes ({clients.length})</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="overview-account-filter"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Conta de Anúncios
              </label>
              <select
                id="overview-account-filter"
                value={adAccountId}
                onChange={(e) =>
                  applyFilters({
                    adAccountId: e.target.value,
                    campaignId: "",
                  })
                }
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              >
                <option value="">
                  Todas as contas ({filteredAccounts.length})
                </option>
                {filteredAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="overview-campaign-filter"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Campanha
              </label>
              <select
                id="overview-campaign-filter"
                value={campaignId}
                onChange={(e) => applyFilters({ campaignId: e.target.value })}
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              >
                <option value="">
                  Todas as campanhas ({campaigns.length})
                </option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="overview-period-filter"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Período de Análise
              </label>
              <select
                id="overview-period-filter"
                value={String(periodDays)}
                onChange={(e) =>
                  applyFilters({ periodDays: Number(e.target.value) })
                }
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              >
                <option value="7">Últimos 7 dias</option>
                <option value="14">Últimos 14 dias</option>
                <option value="30">Últimos 30 dias</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Primary KPI Grid (10 real metrics + period comparison) */}
      <section aria-label="Indicadores Principais de Desempenho">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Card>
            <CardContent className="pt-4 pb-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Investimento</span>
                <DollarSign className="h-4 w-4 text-cyan-500" />
              </div>
              <p className="text-xl font-bold">
                {kpiSummary.hasData ? formatBrl(kpiSummary.spendBrl) : "Sem dados"}
              </p>
              <DeltaBadge deltaPct={kpiSummary.previousPeriod.spendDeltaPct} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Conversões</span>
                <Target className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="text-xl font-bold">
                {kpiSummary.hasData
                  ? formatNumber(kpiSummary.conversions)
                  : "Sem dados"}
              </p>
              <DeltaBadge
                deltaPct={kpiSummary.previousPeriod.conversionsDeltaPct}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>CPA / ROAS</span>
                <TrendingUp className="h-4 w-4 text-cyan-500" />
              </div>
              <p className="text-xl font-bold">
                {kpiSummary.cpaBrl !== null
                  ? formatBrl(kpiSummary.cpaBrl)
                  : "Sem dados"}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                ROAS:{" "}
                {kpiSummary.roas !== null ? `${kpiSummary.roas}x` : "Sem dados"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Cliques & CTR</span>
                <MousePointerClick className="h-4 w-4 text-cyan-500" />
              </div>
              <p className="text-xl font-bold">
                {kpiSummary.hasData
                  ? formatNumber(kpiSummary.clicks)
                  : "Sem dados"}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                CTR:{" "}
                {kpiSummary.ctrPct !== null
                  ? `${kpiSummary.ctrPct}%`
                  : "Sem dados"}{" "}
                · CPC: {formatBrl(kpiSummary.cpcBrl)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Consumo de Orçamento</span>
                <Wallet className="h-4 w-4 text-amber-500" />
              </div>
              <p className="text-xl font-bold">
                {kpiSummary.budgetConsumptionPct !== null
                  ? `${kpiSummary.budgetConsumptionPct}%`
                  : "Sem dados"}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Teto: {formatBrl(kpiSummary.totalMonthlyBudgetBrl)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Secondary Metrics Strip: Impressões & Taxa de Conversão */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
              <Eye className="h-4 w-4 text-cyan-500" />
              Impressões ({periodDays} dias)
            </span>
            <span className="font-semibold">
              {kpiSummary.hasData
                ? formatNumber(kpiSummary.impressions)
                : "Sem dados"}
            </span>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
              <Percent className="h-4 w-4 text-emerald-500" />
              Taxa de Conversão ({periodDays} dias)
            </span>
            <span className="font-semibold">
              {kpiSummary.conversionRatePct !== null
                ? `${kpiSummary.conversionRatePct}%`
                : "Sem dados"}
            </span>
          </div>
        </div>
      </section>

      {/* Chart & Campaigns Performance */}
      {dailyMetrics.length > 0 ? (
        <PerformanceChart metrics={dailyMetrics} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Evolução de Investimento e Conversões
            </CardTitle>
            <CardDescription>
              Nenhuma métrica sincronizada no período selecionado. Conecte o
              Google Ads em{" "}
              <Link
                href="/integracoes"
                className="text-cyan-600 dark:text-cyan-400 underline"
              >
                Integrações
              </Link>{" "}
              e execute a primeira sincronização para visualizar gráficos reais.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {campaigns.length > 0 && <CampaignsTable campaigns={campaigns} />}

      {/* Quick Commercial Actions: Clients & Executive Reports */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Client Registration & Active Clients */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-cyan-500" />
                  Carteira de Clientes
                </CardTitle>
                <CardDescription>
                  Cadastre clientes e acesse o painel comercial individual.
                </CardDescription>
              </div>
              <Link
                href="/clientes"
                className="text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline inline-flex items-center gap-1"
              >
                Ver todos <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {clientSuccess && (
              <div
                role="status"
                data-testid="management-success-status"
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
              >
                {clientSuccess}
              </div>
            )}
            {clientError && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
              >
                {clientError}
              </div>
            )}

            <form
              onSubmit={handleCreateClient}
              className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
            >
              <input
                data-testid="create-client-name-input"
                type="text"
                required
                placeholder="Nome do cliente"
                aria-label="Nome do cliente"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
              <input
                data-testid="create-client-industry-input"
                type="text"
                required
                placeholder="Segmento (ex.: Odontologia)"
                aria-label="Segmento do cliente"
                value={clientIndustry}
                onChange={(e) => setClientIndustry(e.target.value)}
                className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
              <input
                data-testid="create-client-budget-input"
                type="number"
                required
                min="1"
                step="0.01"
                placeholder="Orçamento mensal (R$)"
                aria-label="Orçamento mensal em reais"
                value={clientBudget}
                onChange={(e) => setClientBudget(e.target.value)}
                className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
              <input
                data-testid="create-client-cpa-input"
                type="number"
                required
                min="1"
                step="0.01"
                placeholder="CPA desejado (R$)"
                aria-label="Meta de CPA em reais"
                value={clientTargetCpa}
                onChange={(e) => setClientTargetCpa(e.target.value)}
                className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
              <Button
                type="submit"
                disabled={creatingClient}
                data-testid="create-client-submit-btn"
                className="sm:col-span-2"
              >
                <Plus className="h-4 w-4" />
                {creatingClient ? "Salvando..." : "Cadastrar Cliente"}
              </Button>
            </form>

            {clients.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                {clients.slice(0, 5).map((cli) => (
                  <Link
                    key={cli.id}
                    href={`/clientes/${cli.id}`}
                    className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="min-w-0">
                      <p
                        data-testid={`client-card-name-${cli.id}`}
                        className="text-xs font-semibold truncate"
                      >
                        {cli.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {cli.industry} · Teto:{" "}
                        {formatBrl(cli.monthlyBudgetCapBrl)}
                      </p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-slate-400 shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Executive Reports & AI Center */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileBarChart2 className="h-4 w-4 text-cyan-500" />
                  Relatórios Executivos & IA
                </CardTitle>
                <CardDescription>
                  Gere relatórios comerciais por cliente com exportação em PDF.
                </CardDescription>
              </div>
              <Link
                href="/relatorios"
                className="text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline inline-flex items-center gap-1"
              >
                Abrir Relatórios <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {reportSuccess && (
              <div
                role="status"
                data-testid="ai-center-success-status"
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
              >
                {reportSuccess}
              </div>
            )}
            {reportError && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
              >
                {reportError}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={generatingReport || clients.length === 0}
                data-testid="generate-executive-report-btn"
                onClick={handleGenerateReport}
              >
                <FileBarChart2 className="h-4 w-4" />
                {generatingReport
                  ? "Gerando relatório..."
                  : "Gerar Relatório Executivo"}
              </Button>
              <Link href="/ia">
                <Button type="button" variant="outline">
                  <Sparkles className="h-4 w-4" />
                  Central de IA
                </Button>
              </Link>
            </div>

            {reports.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Nenhum relatório gerado ainda. Cadastre um cliente e clique em
                &quot;Gerar Relatório Executivo&quot;.
              </p>
            ) : (
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                {reports.slice(0, 4).map((rep) => (
                  <div
                    key={rep.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p
                        data-testid={`executive-report-title-${rep.id}`}
                        className="text-xs font-semibold truncate"
                      >
                        {rep.title}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {rep.periodStart} a {rep.periodEnd}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary">PDF</Badge>
                      <Link
                        href={`/relatorios/${rep.id}/imprimir`}
                        className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                      >
                        Abrir
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
