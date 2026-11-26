"use client";

import * as React from "react";
import {
  Activity,
  CheckCircle2,
  DollarSign,
  Target,
  TrendingUp,
} from "lucide-react";
import type {
  NormalizedCampaign,
  NormalizedDailyMetric,
} from "@/integrations/contracts/advertising-provider";
import type { AIRecommendation } from "@/modules/ai/schemas/recommendation-schemas";
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
import { PerformanceChart } from "./performance-chart";
import { CampaignsTable } from "./campaigns-table";
import { AIRecommendationsPanel } from "./ai-recommendations-panel";

export interface DashboardOverviewProps {
  readonly organizationName: string;
  readonly campaigns: NormalizedCampaign[];
  readonly dailyMetrics: NormalizedDailyMetric[];
  readonly recommendations: AIRecommendation[];
  readonly domainTables: readonly string[];
  readonly emergencyStopActive: boolean;
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
    detail: "Valida ApprovalRecord assinado, expiração e RBAC do aprovador",
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

export function DashboardOverview({
  organizationName,
  campaigns,
  dailyMetrics,
  recommendations,
  domainTables,
  emergencyStopActive,
}: DashboardOverviewProps) {
  const totalSpend7d = React.useMemo(
    () => campaigns.reduce((acc, item) => acc + item.spend7dBrl, 0),
    [campaigns]
  );
  const totalConversions7d = React.useMemo(
    () => campaigns.reduce((acc, item) => acc + item.conversions7d, 0),
    [campaigns]
  );
  const avgCpa7d =
    totalConversions7d > 0 ? totalSpend7d / totalConversions7d : 0;
  const weightedRoas =
    totalSpend7d > 0
      ? campaigns.reduce(
          (acc, item) => acc + item.roas7d * item.spend7dBrl,
          0
        ) / totalSpend7d
      : 0;

  return (
    <main className="flex-1 p-3 sm:p-4 lg:p-8 space-y-6 lg:space-y-8 max-w-[1600px] w-full mx-auto">
      {/* Section 1: Overview & Analytical KPI Cards */}
      <section id="overview" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-lg sm:text-xl lg:text-2xl font-bold tracking-tight">
              Command Center — Gestão & Automação Supervisionada
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Organização: <strong>{organizationName}</strong> • Janela
              Analítica: Últimos 7 dias (Dados Demonstrativos)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="demo">MODO DEMONSTRAÇÃO • SOMENTE LEITURA</Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardDescription>Investimento Consolidado (7d)</CardDescription>
              <DollarSign
                className="h-4 w-4 text-cyan-600 dark:text-cyan-400"
                aria-hidden="true"
              />
            </CardHeader>
            <CardContent>
              <div className="text-xl sm:text-2xl font-bold">
                {formatCurrencyBrl(totalSpend7d)}
              </div>
              <div className="flex items-center justify-between mt-2 text-xs text-slate-500 dark:text-slate-400">
                <span>{campaigns.length} campanhas monitoradas</span>
                <Badge variant="demo">DEMO</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardDescription>Conversões Rastreadas (7d)</CardDescription>
              <Target
                className="h-4 w-4 text-cyan-600 dark:text-cyan-400"
                aria-hidden="true"
              />
            </CardHeader>
            <CardContent>
              <div className="text-xl sm:text-2xl font-bold">
                {formatNumberPtBr(totalConversions7d)}
              </div>
              <div className="flex items-center justify-between mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                <span>+14,2% vs. semana anterior</span>
                <Badge variant="demo">DEMO</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardDescription>
                Custo por Aquisição Médio (CPA)
              </CardDescription>
              <Activity
                className="h-4 w-4 text-cyan-600 dark:text-cyan-400"
                aria-hidden="true"
              />
            </CardHeader>
            <CardContent>
              <div className="text-xl sm:text-2xl font-bold">
                {formatCurrencyBrl(avgCpa7d)}
              </div>
              <div className="flex items-center justify-between mt-2 text-xs text-slate-500 dark:text-slate-400">
                <span>Meta ponderada: R$ 42,00</span>
                <Badge variant="success">Dentro da Meta</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardDescription>ROAS Médio Ponderado (7d)</CardDescription>
              <TrendingUp
                className="h-4 w-4 text-cyan-600 dark:text-cyan-400"
                aria-hidden="true"
              />
            </CardHeader>
            <CardContent>
              <div className="text-xl sm:text-2xl font-bold">
                {weightedRoas.toFixed(2).replace(".", ",")}x
              </div>
              <div className="flex items-center justify-between mt-2 text-xs text-slate-500 dark:text-slate-400">
                <span>CTR Médio: {formatPercentPtBr(4.78)}</span>
                <Badge variant="demo">DEMO</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Section 2: Interactive Chart + Automation Governance Summary */}
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
                  ? "SUSPENSO (SIMULAÇÃO)"
                  : "SANDBOX SUPERVISIONADO"}
              </Badge>
            </div>
            <CardDescription>
              Pipeline de 9 etapas com Máquina de Estados, Cooldown e Idempotência
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
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-2">
                Fluxo Obrigatório Auditável
              </span>
              <div className="flex flex-wrap gap-1.5">
                {MANDATORY_PIPELINE_STAGES.map((stage) => (
                  <span
                    key={stage}
                    className="text-[11px] rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-700 dark:text-cyan-300 px-2 py-0.5"
                  >
                    {stage}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Section 3: TanStack Table of Campaigns */}
      <section id="campaigns">
        <CampaignsTable campaigns={campaigns} />
      </section>

      {/* Section 4: AI Supervised Recommendations */}
      <section id="ai-recommendations">
        <AIRecommendationsPanel
          recommendations={recommendations}
          emergencyStopActive={emergencyStopActive}
        />
      </section>

      {/* Section 5: Drizzle 22 Domains & Provider Readiness Status */}
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
                  com USING/WITH CHECK e migrations versionadas
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
