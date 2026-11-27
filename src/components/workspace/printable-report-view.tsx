"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import type { PersistedExecutiveReport } from "@/infrastructure/db/repositories/ai-recommendations-reports-repository";
import type { NormalizedDailyMetric } from "@/integrations/contracts/advertising-provider";
import type { AuditEventViewModel } from "@/application/use-cases/dashboard-overview-use-case";
import type { PeriodKpiSummary } from "@/application/use-cases/operational-workspace-loader";

function formatBrl(v: number | null): string {
  if (v === null) return "Sem dados";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function PrintableReportView({
  report,
  organizationName,
  clientName,
  dailyMetrics,
  kpiSummary,
  recentActions,
}: {
  readonly report: PersistedExecutiveReport;
  readonly organizationName: string;
  readonly clientName: string;
  readonly dailyMetrics: NormalizedDailyMetric[];
  readonly kpiSummary: PeriodKpiSummary;
  readonly recentActions: readonly AuditEventViewModel[];
}) {
  return (
    <div className="min-h-screen bg-white text-slate-900 p-6 sm:p-10 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-200 print:hidden">
        <Link
          href="/relatorios"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para Relatórios
        </Link>
        <Button type="button" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Imprimir / Salvar em PDF
        </Button>
      </div>

      {/* Konnexy Branded Header */}
      <header className="flex items-center justify-between gap-4 border-b-2 border-cyan-600 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl overflow-hidden border border-cyan-500/40 bg-[#060d1a]">
            <Image
              src="/konnexy-logo.jpg"
              alt="Logo Konnexy Ads"
              width={48}
              height={48}
              className="object-cover h-full w-full"
            />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider font-semibold text-cyan-700">
              KONNEXY ADS — Relatório Comercial Executivo
            </p>
            <h1 className="text-xl font-bold text-slate-900">{report.title}</h1>
            <p className="text-xs text-slate-600">
              Organização: {organizationName} · Cliente: {clientName} · Período:{" "}
              {report.periodStart} a {report.periodEnd}
            </p>
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>Emitido em</p>
          <p className="font-semibold text-slate-800">
            {new Date(report.createdAtIso).toLocaleDateString("pt-BR")}
          </p>
        </div>
      </header>

      {/* Executive Summary */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-cyan-800">
          1. Resumo Executivo
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          {report.executiveSummary}
        </p>
      </section>

      {/* KPIs & Period Comparison */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-cyan-800">
          2. Indicadores e Comparativo de Desempenho
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-slate-500">Investimento</p>
            <p className="text-base font-bold mt-0.5">
              {kpiSummary.hasData ? formatBrl(kpiSummary.spendBrl) : "Sem dados"}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-slate-500">Conversões</p>
            <p className="text-base font-bold mt-0.5">
              {kpiSummary.hasData
                ? kpiSummary.conversions.toLocaleString("pt-BR")
                : "Sem dados"}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-slate-500">CPA Médio</p>
            <p className="text-base font-bold mt-0.5">
              {formatBrl(kpiSummary.cpaBrl)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-slate-500">ROAS</p>
            <p className="text-base font-bold mt-0.5">
              {kpiSummary.roas !== null ? `${kpiSummary.roas}x` : "Sem dados"}
            </p>
          </div>
        </div>
      </section>

      {/* Chart */}
      {dailyMetrics.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-cyan-800">
            3. Evolução de Desempenho no Período
          </h2>
          <PerformanceChart metrics={dailyMetrics} />
        </section>
      )}

      {/* Key Insights & Recommendations */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-cyan-800">
          4. Recomendações e Próximos Passos
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Revise as recomendações pendentes na Central de IA e acompanhe o ritmo
          de orçamento e metas de CPA/ROAS no painel do cliente.
        </p>
      </section>

      {/* Completed Actions */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-cyan-800">
          5. Ações Realizadas no Período
        </h2>
        {recentActions.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nenhuma alteração operacional registrada no período selecionado.
          </p>
        ) : (
          <ul className="space-y-1 text-xs text-slate-700">
            {recentActions.slice(0, 10).map((act) => (
              <li key={act.id} className="flex justify-between border-b border-slate-100 py-1">
                <span className="font-medium">{act.action}</span>
                <span className="text-slate-500">
                  {new Date(act.timestamp).toLocaleString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="pt-4 border-t border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
        <span>Konnexy Ads — ads.konnexy.com.br</span>
        <span>Relatório baseado exclusivamente em dados reais persistidos</span>
      </footer>
    </div>
  );
}
