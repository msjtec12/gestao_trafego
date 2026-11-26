"use client";

import * as React from "react";
import {
  LayoutDashboard,
  Megaphone,
  Sparkles,
  Cpu,
  Database,
  ShieldAlert,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
  Moon,
  AlertOctagon,
  FlaskConical,
  CheckCircle2,
  TrendingUp,
  DollarSign,
  Target,
  Activity,
  Menu,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import type {
  NormalizedCampaign,
  NormalizedDailyMetric,
} from "@/integrations/contracts/advertising-provider";
import type { AIRecommendation } from "@/modules/ai/schemas/recommendation-schemas";
import { ALL_DOMAIN_TABLES } from "@/infrastructure/db/schema";
import {
  formatCurrencyBrl,
  formatNumberPtBr,
  formatPercentPtBr,
} from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { CommandPalette } from "./command-palette";

export interface DashboardShellProps {
  readonly organizationName: string;
  readonly organizationId: string;
  readonly campaigns: NormalizedCampaign[];
  readonly dailyMetrics: NormalizedDailyMetric[];
  readonly recommendations: AIRecommendation[];
}

const NAV_ITEMS = [
  { id: "overview", label: "Visão Geral & KPIs", icon: LayoutDashboard },
  { id: "campaigns", label: "Campanhas (Mock Demo)", icon: Megaphone },
  { id: "ai-recommendations", label: "IA Supervisionada", icon: Sparkles },
  { id: "automation-engine", label: "Motor de Automações", icon: Cpu },
  { id: "architecture-docs", label: "Domínios Drizzle & Segurança", icon: Database },
];

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
    detail: "Condições compostas, janela temporal (7d) e amostra mínima",
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
    detail: "Exige aprovação explícita de OWNER, ADMIN ou TRAFFIC_MANAGER",
  },
  {
    name: "Simulation Engine",
    detail: "Projeção de delta de orçamento e redução de CPA pré-execução",
  },
  {
    name: "Execution Engine",
    detail: "IdempotencyKey único, Cooldown de 360m e Circuit Breaker",
  },
  {
    name: "Audit Engine",
    detail: "Trilha imutável com estado anterior, novo estado e correlationId",
  },
];

export function DashboardShell({
  organizationName,
  organizationId,
  campaigns,
  dailyMetrics,
  recommendations,
}: DashboardShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState("overview");
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [emergencyStopActive, setEmergencyStopActive] = React.useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const totalSpend7d = React.useMemo(
    () => campaigns.reduce((acc, item) => acc + item.spend7dBrl, 0),
    [campaigns]
  );
  const totalConversions7d = React.useMemo(
    () => campaigns.reduce((acc, item) => acc + item.conversions7d, 0),
    [campaigns]
  );
  const avgCpa7d = totalConversions7d > 0 ? totalSpend7d / totalConversions7d : 0;
  const weightedRoas =
    totalSpend7d > 0
      ? campaigns.reduce((acc, item) => acc + item.roas7d * item.spend7dBrl, 0) /
        totalSpend7d
      : 0;

  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    setMobileMenuOpen(false);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#060d1a] text-slate-900 dark:text-slate-100">
      {/* Desktop Collapsible Sidebar */}
      <aside
        aria-label="Navegação Principal Konnexy Ads"
        className={`hidden lg:flex flex-col border-r border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#081121] transition-all duration-200 shrink-0 ${
          sidebarCollapsed ? "w-20" : "w-68"
        }`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800/90">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="h-9 w-9 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-bold shrink-0">
              K
            </div>
            {!sidebarCollapsed && (
              <div className="leading-tight">
                <span className="font-bold text-sm tracking-tight block text-slate-900 dark:text-white">
                  KONNEXY <span className="text-cyan-400">ADS</span>
                </span>
                <span className="text-[11px] text-slate-400 block">
                  ads.konnexy.com.br
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 cursor-pointer"
            aria-label={
              sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"
            }
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                  isActive
                    ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 text-cyan-400" />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {!sidebarCollapsed && (
          <div className="p-4 m-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/70 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Tenant Isolado</span>
              <Badge variant="default">RLS Ativo</Badge>
            </div>
            <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">
              {organizationName}
            </p>
            <code className="text-[11px] text-cyan-600 dark:text-cyan-400 block truncate">
              org_id: {organizationId}
            </code>
          </div>
        )}
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex bg-slate-950/75 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-72 bg-[#081121] text-slate-100 h-full p-4 flex flex-col justify-between border-r border-slate-800">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <span className="font-bold text-sm">
                  KONNEXY <span className="text-cyan-400">ADS</span>
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Fechar menu mobile"
                >
                  <X className="h-5 w-5 text-slate-400" />
                </button>
              </div>
              <nav className="mt-4 space-y-1.5">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => scrollToSection(item.id)}
                      className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
                    >
                      <Icon className="h-4 w-4 text-cyan-400" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Governance Header */}
        <header className="sticky top-0 z-30 h-16 border-b border-slate-200 dark:border-slate-800/90 bg-white/90 dark:bg-[#081121]/90 backdrop-blur-md px-4 lg:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-700 text-slate-300"
              aria-label="Abrir menu de navegação"
            >
              <Menu className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="flex items-center gap-3 rounded-lg border border-slate-300 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-900/90 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:border-cyan-500/50 transition-colors cursor-pointer"
              aria-label="Abrir Command Palette"
            >
              <Search className="h-3.5 w-3.5 text-cyan-400" />
              <span className="hidden sm:inline">
                Buscar comandos ou campanhas...
              </span>
              <kbd className="rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                Ctrl+K
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <Badge variant="default" className="hidden md:inline-flex">
              <ShieldCheck className="h-3.5 w-3.5" />
              MODO PADRÃO: SOMENTE LEITURA (READ_ONLY)
            </Badge>

            {/* Emergency Kill Switch Button */}
            <Button
              variant={emergencyStopActive ? "destructive" : "outline"}
              size="sm"
              onClick={() => setEmergencyStopActive((prev) => !prev)}
              aria-pressed={emergencyStopActive}
              className={
                emergencyStopActive
                  ? "animate-pulse"
                  : "border-red-500/50 text-red-500 dark:text-red-300 hover:bg-red-950/40"
              }
            >
              <AlertOctagon className="h-3.5 w-3.5" />
              {emergencyStopActive
                ? "KILL SWITCH ATIVO (AUTOMAÇÕES SUSPENSAS)"
                : "Botão de Emergência (Kill Switch)"}
            </Button>

            {mounted && (
              <button
                type="button"
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
                className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                aria-label="Alternar tema claro ou escuro"
              >
                {resolvedTheme === "dark" ? (
                  <Sun className="h-4 w-4 text-amber-400" />
                ) : (
                  <Moon className="h-4 w-4 text-slate-700" />
                )}
              </button>
            )}
          </div>
        </header>

        {/* Explicit Demo Identification Banner (Mandatory Protocol Rule #8 & #14) */}
        <div
          role="status"
          aria-live="polite"
          className="border-b border-amber-500/40 bg-amber-500/10 px-4 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-medium">
            <FlaskConical className="h-4 w-4 text-amber-400 shrink-0" />
            <span>
              <strong>AMBIENTE DEMONSTRATIVO (FOUNDATION STAGE v0.1.0):</strong>{" "}
              Todos os indicadores abaixo são fornecidos pelo{" "}
              <code className="px-1 py-0.5 rounded bg-amber-500/20">
                MockAdsProvider
              </code>{" "}
              (<code className="px-1 py-0.5 rounded bg-amber-500/20">isDemoData: true</code>).
              Nenhuma conta real do Google Ads ou Meta Ads está conectada nesta entrega inicial.
            </span>
          </div>
          <Badge variant="demo">DADOS DE TESTE IDENTIFICADOS</Badge>
        </div>

        {/* Emergency Kill Switch Active Alert Banner */}
        {emergencyStopActive && (
          <div
            role="alert"
            className="border-b border-red-500/50 bg-red-950/90 text-red-100 px-4 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
          >
            <div className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="h-4 w-4 text-red-400 shrink-0" />
              <span>
                PARADA DE EMERGÊNCIA ACIONADA: Todas as regras automatizadas, filas de execução e aprovações foram bloqueadas pelo ExecutionEngine.
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEmergencyStopActive(false)}
            >
              Restaurar Modo Supervisionado
            </Button>
          </div>
        )}

        {/* Main Dashboard Body */}
        <main className="flex-1 p-4 lg:p-8 space-y-8 max-w-[1600px] w-full mx-auto">
          {/* Section 1: Overview & Analytical KPI Cards */}
          <section id="overview" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h1 className="text-xl lg:text-2xl font-bold tracking-tight">
                  Command Center — Gestão & Automação Supervisionada
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Organização: <strong>{organizationName}</strong> • Janela Analítica: Últimos 7 dias (Dados Demonstrativos)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Isolamento Multi-Tenant Ativo
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardDescription>Investimento Consolidado (7d)</CardDescription>
                  <DollarSign className="h-4 w-4 text-cyan-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrencyBrl(totalSpend7d)}
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
                    <span>7 campanhas monitoradas</span>
                    <Badge variant="demo">DEMO</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardDescription>Conversões Rastreadas (7d)</CardDescription>
                  <Target className="h-4 w-4 text-cyan-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatNumberPtBr(totalConversions7d)}
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-emerald-400">
                    <span>+14,2% vs. semana anterior</span>
                    <Badge variant="demo">DEMO</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardDescription>Custo por Aquisição Médio (CPA)</CardDescription>
                  <Activity className="h-4 w-4 text-cyan-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrencyBrl(avgCpa7d)}
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
                    <span>Meta ponderada: R$ 42,00</span>
                    <Badge variant="success">Dentro da Meta</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardDescription>ROAS Médio Ponderado (7d)</CardDescription>
                  <TrendingUp className="h-4 w-4 text-cyan-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {weightedRoas.toFixed(2).replace(".", ",")}x
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
                    <span>CTR Médio: {formatPercentPtBr(4.78)}</span>
                    <Badge variant="demo">DEMO</Badge>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Section 2: Interactive Chart + Automation Governance Summary */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <PerformanceChart metrics={dailyMetrics} />

            <Card id="automation-engine">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Motor de Automações (7 Engines)
                  </CardTitle>
                  <Badge
                    variant={emergencyStopActive ? "destructive" : "success"}
                  >
                    {emergencyStopActive ? "SUSPENSO" : "SUPERVISIONADO"}
                  </Badge>
                </div>
                <CardDescription>
                  Pipeline de 9 etapas com Circuit Breaker, Cooldown e Idempotência
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
                        <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                          {eng.detail}
                        </span>
                      </div>
                      <Badge variant="default">OK</Badge>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-2">
                    Fluxo Obrigatório Auditável
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {MANDATORY_PIPELINE_STAGES.map((stage) => (
                      <span
                        key={stage}
                        className="text-[11px] rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-600 dark:text-cyan-300 px-2 py-0.5"
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
                      Fundação de Dados & Integrações — 22 Domínios Multi-Tenant (Neon PostgreSQL + Drizzle ORM)
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Todas as tabelas operacionais possuem isolamento por organization_id, índices compostos e migration inicial versionada
                    </CardDescription>
                  </div>
                  <Badge variant="default">
                    {ALL_DOMAIN_TABLES.length} Tabelas Modeladas
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {ALL_DOMAIN_TABLES.map((tableName) => (
                    <div
                      key={tableName}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 px-3 py-2 text-xs flex items-center justify-between"
                    >
                      <code className="text-cyan-600 dark:text-cyan-400 font-medium truncate">
                        {tableName}
                      </code>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>
        </main>
      </div>

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onSelectSection={scrollToSection}
        onTriggerKillSwitch={() => setEmergencyStopActive((prev) => !prev)}
      />
    </div>
  );
}
