"use client";

import * as React from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  DollarSign,
  Filter,
  MousePointerClick,
  PlugZap,
  Target,
  TrendingUp,
} from "lucide-react";
import type {
  AdAccountRecordViewModel,
  AuditEventViewModel,
  ClientRecordViewModel,
  IntegrationHealthViewModel,
  MemberRecordViewModel,
  OrganizationOption,
  SyncRunViewModel,
} from "@/application/use-cases/dashboard-overview-use-case";
import type {
  NormalizedCampaign,
  NormalizedDailyMetric,
} from "@/integrations/contracts/advertising-provider";
import type { AIRecommendation } from "@/modules/ai/schemas/recommendation-schemas";
import type {
  PersistedExecutiveReport,
  PersistedRecommendationWithApproval,
} from "@/infrastructure/db/repositories/ai-recommendations-reports-repository";
import {
  formatCurrencyBrl,
  formatNumberPtBr,
  formatPercentPtBr,
} from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { GoogleAdsOAuthConfigStatus } from "@/security/env";
import { PerformanceChart } from "./performance-chart";
import { CampaignsTable } from "./campaigns-table";
import { AIRecommendationsPanel } from "./ai-recommendations-panel";
import { SupervisedAICenter } from "./supervised-ai-center";
import { TenantManagementHub } from "./tenant-management-hub";

export interface DashboardOverviewProps {
  readonly organizationName: string;
  readonly activeOrganization: OrganizationOption;
  readonly organizations: readonly OrganizationOption[];
  readonly onSelectOrganizationId: (orgId: string) => void;
  readonly clients: readonly ClientRecordViewModel[];
  readonly adAccounts: readonly AdAccountRecordViewModel[];
  readonly members: readonly MemberRecordViewModel[];
  readonly integrations: readonly IntegrationHealthViewModel[];
  readonly googleAdsConfigStatus?: GoogleAdsOAuthConfigStatus;
  readonly syncHistory?: readonly SyncRunViewModel[];
  readonly auditTrail?: readonly AuditEventViewModel[];
  readonly campaigns: NormalizedCampaign[];
  readonly dailyMetrics: NormalizedDailyMetric[];
  readonly recommendations: AIRecommendation[];
  readonly persistedRecommendations?: readonly PersistedRecommendationWithApproval[];
  readonly executiveReports?: readonly PersistedExecutiveReport[];
  readonly domainTables: readonly string[];
  readonly emergencyStopActive: boolean;
  readonly lastSyncTimestamp: string | null;
}

const MANDATORY_PIPELINE_STAGES = [
  "1. Coleta",
  "2. Normalização",
  "3. Análise",
  "4. Recomendação",
  "5. Validação",
  "6. Aprovação",
  "7. Execução",
  "8. Verificação",
  "9. Auditoria",
];

const SEVEN_ENGINES = [
  {
    name: "Rule Engine",
    detail: "Condições compostas, janela temporal configurável e amostra mínima",
  },
  {
    name: "Policy Engine",
    detail: "Trava financeira (±20% máx) e bloqueio de produtos restritos",
  },
  {
    name: "Risk Engine",
    detail: "Classificação automática LOW / MEDIUM / HIGH / CRITICAL",
  },
  {
    name: "Approval Engine",
    detail: "Valida ApprovalRecord assinado com SHA-256 actionPayloadHash",
  },
  {
    name: "Simulation Engine",
    detail: "Projeção de delta de orçamento e redução de CPA pré-execução",
  },
  {
    name: "Execution Engine",
    detail: "Idempotency lock concorrente, Cooldown de 360m e Circuit Breaker",
  },
  {
    name: "Audit Engine",
    detail: "Trilha imutável com estado anterior, novo estado e correlationId",
  },
];

export type PeriodWindowDays = 3 | 7 | 14 | 30;

export function DashboardOverview({
  organizationName,
  activeOrganization,
  organizations,
  onSelectOrganizationId,
  clients,
  adAccounts,
  members,
  integrations,
  googleAdsConfigStatus,
  syncHistory = [],
  auditTrail = [],
  campaigns,
  dailyMetrics,
  recommendations,
  persistedRecommendations = [],
  executiveReports = [],
  domainTables,
  emergencyStopActive,
  lastSyncTimestamp,
}: DashboardOverviewProps) {
  const [selectedClientId, setSelectedClientId] = React.useState<string>("ALL");
  const [selectedAccountId, setSelectedAccountId] =
    React.useState<string>("ALL");
  const [periodWindowDays, setPeriodWindowDays] =
    React.useState<PeriodWindowDays>(7);

  const availableAccounts = React.useMemo(() => {
    if (selectedClientId === "ALL") return adAccounts;
    return adAccounts.filter((a) => a.clientId === selectedClientId);
  }, [adAccounts, selectedClientId]);

  const scopedCampaigns = React.useMemo(() => {
    return campaigns.filter((c) => {
      if (selectedClientId !== "ALL" && c.clientId !== selectedClientId) {
        return false;
      }
      if (selectedAccountId !== "ALL") {
        const account = adAccounts.find((a) => a.id === selectedAccountId);
        if (account && c.clientId !== account.clientId) {
          return false;
        }
      }
      return true;
    });
  }, [campaigns, selectedClientId, selectedAccountId, adAccounts]);

  // Section 13 Invariant: Calculate CTR, CPC, CPA, and ROAS strictly over aggregated totals
  const aggregatedMetrics = React.useMemo(() => {
    if (scopedCampaigns.length === 0) {
      return {
        hasData: false,
        spendBrl: 0,
        conversions: 0,
        clicks: 0,
        impressions: 0,
        cpaBrl: null as number | null,
        cpcBrl: null as number | null,
        ctrPct: null as number | null,
        roas: null as number | null,
      };
    }

    const factor =
      periodWindowDays === 3
        ? 3 / 7
        : periodWindowDays === 14
          ? 2
          : periodWindowDays === 30
            ? 30 / 7
            : 1;

    let spendBrl = 0;
    let conversions = 0;
    let clicks = 0;
    let impressions = 0;
    let totalConversionValueBrl = 0;

    for (const camp of scopedCampaigns) {
      const win = camp.metricsByWindowDays?.[periodWindowDays];
      const campSpend = win ? win.spendBrl : camp.spend7dBrl * factor;
      const campConv = win
        ? win.conversions
        : Math.round(camp.conversions7d * factor);
      const campClicks = win ? win.clicks : Math.round(camp.clicks7d * factor);
      const campImpr = win
        ? win.impressions
        : Math.round(camp.impressions7d * factor);
      const campRoas = win ? win.roas : camp.roas7d;

      spendBrl += campSpend;
      conversions += campConv;
      clicks += campClicks;
      impressions += campImpr;
      totalConversionValueBrl += campRoas * campSpend;
    }

    const cpaBrl = conversions > 0 ? spendBrl / conversions : null;
    const cpcBrl = clicks > 0 ? spendBrl / clicks : null;
    const ctrPct = impressions > 0 ? (clicks / impressions) * 100 : null;
    const roas = spendBrl > 0 ? totalConversionValueBrl / spendBrl : null;

    return {
      hasData: true,
      spendBrl,
      conversions,
      clicks,
      impressions,
      cpaBrl,
      cpcBrl,
      ctrPct,
      roas,
    };
  }, [scopedCampaigns, periodWindowDays]);

  return (
    <main className="flex-1 p-3 sm:p-4 lg:p-8 space-y-6 lg:space-y-8 max-w-[1600px] w-full mx-auto">
      <section
        aria-label="Filtros Operacionais Multi-Tenant"
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1629]/95 p-4 space-y-3 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <Filter className="h-4 w-4 text-cyan-500 dark:text-cyan-400" />
            <span>
              Escopo Operacional Multi-Tenant (Organização • Cliente • Conta •
              Janela Temporal)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <Clock className="h-3.5 w-3.5 text-cyan-400" />
              Última Sincronização:{" "}
              <strong className="text-slate-800 dark:text-slate-200">
                {lastSyncTimestamp ??
                  "Sem sincronização registrada (Aguardando conexão OAuth)"}
              </strong>
            </span>
            <Badge
              variant={activeOrganization.isDemo ? "demo" : "default"}
              data-testid="environment-scope-badge"
            >
              {activeOrganization.isDemo
                ? "AMBIENTE DEMO SEPARADO"
                : "AMBIENTE OPERACIONAL (SEM DADOS SIMULADOS)"}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label
              htmlFor="org-selector"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              1. Organização (Tenant)
            </label>
            <select
              id="org-selector"
              data-testid="org-selector"
              value={activeOrganization.id}
              onChange={(e) => {
                onSelectOrganizationId(e.target.value);
                setSelectedClientId("ALL");
                setSelectedAccountId("ALL");
              }}
              className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 text-xs"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="client-selector"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              2. Cliente
            </label>
            <select
              id="client-selector"
              data-testid="client-selector"
              value={selectedClientId}
              onChange={(e) => {
                setSelectedClientId(e.target.value);
                setSelectedAccountId("ALL");
              }}
              className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 text-xs"
            >
              <option value="ALL">Todos os Clientes Autorizados</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="account-selector"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              3. Conta de Anúncios / Subconta MCC
            </label>
            <select
              id="account-selector"
              data-testid="account-selector"
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 text-xs"
            >
              <option value="ALL">Todas as Contas Selecionadas</option>
              {availableAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.externalAccountId})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="period-selector"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              4. Janela Temporal Analítica
            </label>
            <select
              id="period-selector"
              data-testid="period-selector"
              value={periodWindowDays}
              onChange={(e) =>
                setPeriodWindowDays(Number(e.target.value) as PeriodWindowDays)
              }
              className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 text-xs"
            >
              <option value={3}>Últimos 3 dias</option>
              <option value={7}>Últimos 7 dias (Padrão)</option>
              <option value={14}>Últimos 14 dias</option>
              <option value={30}>Últimos 30 dias</option>
            </select>
          </div>
        </div>
      </section>

      <section id="overview" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-lg sm:text-xl lg:text-2xl font-bold tracking-tight">
              Command Center — Gestão & Automação Supervisionada
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Organização: <strong>{organizationName}</strong> • Janela
              Analítica: Últimos {periodWindowDays} dias
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {integrations.map((intg) => (
              <Badge
                key={intg.id}
                variant={
                  intg.status === "CONNECTED"
                    ? "success"
                    : intg.status === "SANDBOX_DEMO"
                      ? "demo"
                      : "warning"
                }
              >
                <PlugZap className="h-3 w-3" aria-hidden="true" />
                {intg.provider}: {intg.status}
              </Badge>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardDescription>
                Investimento ({periodWindowDays}d)
              </CardDescription>
              <DollarSign
                className="h-4 w-4 text-cyan-600 dark:text-cyan-400"
                aria-hidden="true"
              />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold">
                {aggregatedMetrics.hasData
                  ? formatCurrencyBrl(aggregatedMetrics.spendBrl)
                  : "Sem dados"}
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>{scopedCampaigns.length} campanhas</span>
                <Badge
                  variant={activeOrganization.isDemo ? "demo" : "secondary"}
                >
                  {activeOrganization.isDemo ? "DEMO" : "POSTGRESQL"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardDescription>
                Conversões ({periodWindowDays}d)
              </CardDescription>
              <Target
                className="h-4 w-4 text-cyan-600 dark:text-cyan-400"
                aria-hidden="true"
              />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold">
                {aggregatedMetrics.hasData
                  ? formatNumberPtBr(aggregatedMetrics.conversions)
                  : "Sem dados"}
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px] text-emerald-600 dark:text-emerald-400">
                <span>
                  {aggregatedMetrics.hasData
                    ? `${formatNumberPtBr(aggregatedMetrics.clicks)} cliques`
                    : "Aguardando sync"}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardDescription>CPA Médio ({periodWindowDays}d)</CardDescription>
              <Activity
                className="h-4 w-4 text-cyan-600 dark:text-cyan-400"
                aria-hidden="true"
              />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold">
                {!aggregatedMetrics.hasData
                  ? "Sem dados"
                  : aggregatedMetrics.cpaBrl !== null
                    ? formatCurrencyBrl(aggregatedMetrics.cpaBrl)
                    : "N/D (0 conv.)"}
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>Meta: R$ 42,00</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardDescription>CPC Médio ({periodWindowDays}d)</CardDescription>
              <MousePointerClick
                className="h-4 w-4 text-cyan-600 dark:text-cyan-400"
                aria-hidden="true"
              />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold">
                {!aggregatedMetrics.hasData
                  ? "Sem dados"
                  : aggregatedMetrics.cpcBrl !== null
                    ? formatCurrencyBrl(aggregatedMetrics.cpcBrl)
                    : "N/D (0 cliques)"}
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>Leilão Normalizado</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardDescription>CTR Médio ({periodWindowDays}d)</CardDescription>
              <Activity
                className="h-4 w-4 text-cyan-600 dark:text-cyan-400"
                aria-hidden="true"
              />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold">
                {!aggregatedMetrics.hasData
                  ? "Sem dados"
                  : aggregatedMetrics.ctrPct !== null
                    ? formatPercentPtBr(aggregatedMetrics.ctrPct)
                    : "N/D (0 impr.)"}
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>
                  {aggregatedMetrics.hasData
                    ? `${formatNumberPtBr(aggregatedMetrics.impressions)} impr.`
                    : "0 impr."}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardDescription>
                ROAS Ponderado ({periodWindowDays}d)
              </CardDescription>
              <TrendingUp
                className="h-4 w-4 text-cyan-600 dark:text-cyan-400"
                aria-hidden="true"
              />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold">
                {!aggregatedMetrics.hasData
                  ? "Sem dados"
                  : aggregatedMetrics.roas !== null
                    ? `${aggregatedMetrics.roas.toFixed(2).replace(".", ",")}x`
                    : "N/D"}
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>Retorno Bruto</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <PerformanceChart metrics={dailyMetrics} />

        <Card id="automation-engine">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">
                Motor de Automações (7 Engines)
              </CardTitle>
              <Badge variant={emergencyStopActive ? "destructive" : "demo"}>
                {emergencyStopActive
                  ? "SUSPENSO"
                  : "SANDBOX SUPERVISIONADO"}
              </Badge>
            </div>
            <CardDescription>
              Pipeline de 9 etapas com Máquina de Estados, Cooldown e
              Idempotência
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {SEVEN_ENGINES.map((eng) => (
                <div
                  key={eng.name}
                  className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-50 dark:bg-slate-900/60 px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                      {eng.name}
                    </span>
                    <span className="text-slate-600 dark:text-slate-400 text-[11px]">
                      {eng.detail}
                    </span>
                  </div>
                  <Badge variant="default">Contrato OK</Badge>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 block mb-2">
                Fluxo Obrigatório Auditável
              </span>
              <div className="flex flex-wrap gap-1.5">
                {MANDATORY_PIPELINE_STAGES.map((stage) => (
                  <span
                    key={stage}
                    className="text-[11px] rounded bg-cyan-950 border border-cyan-600/50 text-cyan-100 px-2 py-0.5"
                  >
                    {stage}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <TenantManagementHub
          activeOrganization={activeOrganization}
          clients={clients}
          adAccounts={adAccounts}
          members={members}
          integrations={integrations}
          googleAdsConfigStatus={googleAdsConfigStatus}
          syncHistory={syncHistory}
          auditTrail={auditTrail}
        />
      </section>

      <section id="campaigns">
        <CampaignsTable campaigns={scopedCampaigns} />
      </section>

      <section id="ai-recommendations" className="space-y-6">
        {activeOrganization.isDemo ? (
          <AIRecommendationsPanel
            recommendations={recommendations}
            emergencyStopActive={emergencyStopActive}
          />
        ) : (
          <SupervisedAICenter
            isDemoEnvironment={activeOrganization.isDemo}
            emergencyStopActive={emergencyStopActive}
            clients={clients}
            persistedRecommendations={persistedRecommendations}
            executiveReports={executiveReports}
          />
        )}
      </section>

      <section id="architecture-docs">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">
                  Fundação de Dados & Integrações — 22 Domínios Multi-Tenant
                  (Neon PostgreSQL + Drizzle ORM)
                </CardTitle>
                <CardDescription className="mt-1">
                  Schemas com FKs compostas (organization_id, id), políticas RLS
                  com USING/WITH CHECK e privilégios por tabela
                </CardDescription>
              </div>
              <Badge variant="default">
                {domainTables.length} Tabelas Modeladas
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {domainTables.map((tableName) => (
                <div
                  key={tableName}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 px-3 py-2 text-xs flex items-center justify-between gap-2"
                >
                  <code className="text-cyan-700 dark:text-cyan-400 font-medium truncate">
                    {tableName}
                  </code>
                  <CheckCircle2
                    className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400 shrink-0"
                    aria-hidden="true"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
