"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileBarChart2, Printer, Plus, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { generateExecutiveReportServerAction } from "@/app/actions/operational-actions";
import type { CommercialClientViewModel } from "@/application/use-cases/operational-workspace-loader";
import type { PersistedExecutiveReport } from "@/infrastructure/db/repositories/ai-recommendations-reports-repository";

export function CommercialReportsClient({
  clients,
  reports: initialReports,
}: {
  readonly clients: readonly CommercialClientViewModel[];
  readonly reports: readonly PersistedExecutiveReport[];
}) {
  const router = useRouter();
  const [reports, setReports] =
    React.useState<readonly PersistedExecutiveReport[]>(initialReports);
  const [selectedClientId, setSelectedClientId] = React.useState(
    clients[0]?.id ?? ""
  );
  const [periodDays, setPeriodDays] = React.useState(30);
  const [generating, setGenerating] = React.useState(false);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess(null);
    setError(null);
    if (!selectedClientId) {
      setError("Selecione um cliente para gerar o relatório comercial.");
      return;
    }
    setGenerating(true);
    try {
      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setUTCDate(endDate.getUTCDate() - periodDays);
      const res = await generateExecutiveReportServerAction({
        clientId: selectedClientId,
        periodStart: startDate.toISOString().slice(0, 10),
        periodEnd: endDate.toISOString().slice(0, 10),
      });
      if (!res.ok || !res.report) {
        setError(res.error ?? "Não foi possível gerar o relatório.");
        return;
      }
      setReports((prev) => [res.report!, ...prev]);
      setSuccess("Relatório comercial gerado e salvo no PostgreSQL.");
      router.refresh();
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4 text-cyan-500" />
            Gerar Novo Relatório Comercial
          </CardTitle>
          <CardDescription>
            Consolida indicadores reais, comparativo de desempenho, ações
            realizadas, recomendações e próximos passos com identidade visual
            Konnexy e exportação em PDF.
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
            onSubmit={handleGenerate}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="min-w-[220px] flex-1">
              <label
                htmlFor="rep-client"
                className="block text-xs font-medium mb-1"
              >
                Cliente
              </label>
              <select
                id="rep-client"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              >
                {clients.length === 0 && (
                  <option value="">Cadastre um cliente primeiro</option>
                )}
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-44">
              <label
                htmlFor="rep-period"
                className="block text-xs font-medium mb-1"
              >
                Período
              </label>
              <select
                id="rep-period"
                value={String(periodDays)}
                onChange={(e) => setPeriodDays(Number(e.target.value))}
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              >
                <option value="7">Últimos 7 dias</option>
                <option value="14">Últimos 14 dias</option>
                <option value="30">Últimos 30 dias</option>
              </select>
            </div>

            <Button
              type="submit"
              disabled={generating || clients.length === 0}
            >
              <FileBarChart2 className="h-4 w-4" />
              {generating ? "Gerando..." : "Gerar Relatório"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <FileBarChart2 className="h-8 w-8 text-slate-400 mx-auto" />
            <p className="text-sm font-medium">Nenhum relatório gerado ainda</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Selecione um cliente e o período acima para gerar seu primeiro
              relatório executivo com exportação em PDF.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {reports.map((rep) => (
            <Card key={rep.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{rep.title}</CardTitle>
                    <CardDescription className="flex items-center gap-1.5 mt-1">
                      <Calendar className="h-3.5 w-3.5" />
                      Período: {rep.periodStart} a {rep.periodEnd}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {new Date(rep.createdAtIso).toLocaleDateString("pt-BR")}
                    </Badge>
                    <Link href={`/relatorios/${rep.id}/imprimir`}>
                      <Button size="sm" variant="outline">
                        <Printer className="h-3.5 w-3.5" />
                        Exportar PDF
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                  {rep.executiveSummary}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
