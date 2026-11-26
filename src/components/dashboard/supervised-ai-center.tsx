"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  FileText,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Lock,
  AlertTriangle,
  Fingerprint,
  Cpu,
} from "lucide-react";
import type { ClientRecordViewModel } from "@/application/use-cases/dashboard-overview-use-case";
import type {
  PersistedExecutiveReport,
  PersistedRecommendationWithApproval,
} from "@/infrastructure/db/repositories/ai-recommendations-reports-repository";
import {
  generateExecutiveReportServerAction,
  reviewRecommendationServerAction,
  runSupervisedAIAnalysisServerAction,
} from "@/app/actions/operational-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface SupervisedAICenterProps {
  readonly isDemoEnvironment: boolean;
  readonly emergencyStopActive: boolean;
  readonly clients: readonly ClientRecordViewModel[];
  readonly persistedRecommendations: readonly PersistedRecommendationWithApproval[];
  readonly executiveReports: readonly PersistedExecutiveReport[];
}

export function SupervisedAICenter({
  isDemoEnvironment,
  emergencyStopActive,
  clients,
  persistedRecommendations: initialRecommendations,
  executiveReports: initialReports,
}: SupervisedAICenterProps) {
  const router = useRouter();
  const [recommendations, setRecommendations] = React.useState(
    initialRecommendations
  );
  const [reports, setReports] = React.useState(initialReports);
  const [selectedClientId, setSelectedClientId] = React.useState<string>(
    clients[0]?.id ?? ""
  );
  const [periodStart, setPeriodStart] = React.useState("2026-11-01");
  const [periodEnd, setPeriodEnd] = React.useState("2026-11-26");
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [busyAction, setBusyAction] = React.useState<string | null>(null);

  React.useEffect(() => {
    setRecommendations(initialRecommendations);
  }, [initialRecommendations]);

  React.useEffect(() => {
    setReports(initialReports);
  }, [initialReports]);

  React.useEffect(() => {
    if (!selectedClientId && clients[0]?.id) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  const handleRunAIAnalysis = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    if (isDemoEnvironment) {
      setErrorMessage(
        "O ambiente demonstrativo (/demo) não persiste análises. Faça login em /login para executar os 9 analisadores no PostgreSQL."
      );
      return;
    }

    setBusyAction("analyze");
    try {
      const res = await runSupervisedAIAnalysisServerAction({
        clientId: selectedClientId || undefined,
      });
      if (!res.ok) {
        setErrorMessage(res.error ?? "Erro ao executar análise supervisionada.");
        return;
      }
      setStatusMessage(
        `Análise supervisionada concluída (${res.createdCount ?? 0} recomendação(ões) persistidas, ${res.blockedByPolicyCount ?? 0} bloqueada(s) pelo PolicyEngine).`
      );
      router.refresh();
    } finally {
      setBusyAction(null);
    }
  };

  const handleReviewDecision = async (
    recommendationId: string,
    decision: "APPROVED" | "REJECTED"
  ) => {
    setErrorMessage(null);
    setStatusMessage(null);
    setBusyAction(recommendationId);
    try {
      const res = await reviewRecommendationServerAction({
        recommendationId,
        decision,
      });
      if (!res.ok) {
        setErrorMessage(res.error ?? "Erro ao registrar decisão assinada.");
        return;
      }

      setRecommendations((prev) =>
        prev.map((rec) =>
          rec.id === recommendationId
            ? {
                ...rec,
                status: decision,
                approvalId: res.approvalId ?? rec.approvalId,
                actionPayloadHash:
                  res.actionPayloadHash ?? rec.actionPayloadHash,
                reviewedAtIso: new Date().toISOString(),
              }
            : rec
        )
      );

      setStatusMessage(
        decision === "APPROVED"
          ? `Aprovação assinada com SHA-256 (${res.actionPayloadHash?.slice(0, 12)}...) persistida em approvals (modo READ_ONLY preservado).`
          : "Recomendação rejeitada e registrada em audit_logs."
      );
      router.refresh();
    } finally {
      setBusyAction(null);
    }
  };

  const handleGenerateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    if (isDemoEnvironment) {
      setErrorMessage(
        "O ambiente demonstrativo (/demo) é somente leitura. Faça login para persistir relatórios executivos."
      );
      return;
    }

    if (!selectedClientId) {
      setErrorMessage(
        "Cadastre e selecione um cliente ativo antes de gerar o relatório executivo."
      );
      return;
    }

    setBusyAction("report");
    try {
      const res = await generateExecutiveReportServerAction({
        clientId: selectedClientId,
        periodStart,
        periodEnd,
      });
      if (!res.ok) {
        setErrorMessage(res.error ?? "Erro ao gerar relatório executivo.");
        return;
      }
      if (res.report) {
        const createdReport = res.report;
        setReports((prev) =>
          prev.some((r) => r.id === createdReport.id)
            ? prev
            : [createdReport, ...prev]
        );
      }
      setStatusMessage(
        "Relatório Executivo gerado e persistido no PostgreSQL (tabela reports) com trilha de auditoria."
      );
      router.refresh();
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div id="supervised-ai-center" className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles
                  className="h-5 w-5 text-cyan-400"
                  aria-hidden="true"
                />
                <CardTitle className="text-base">
                  Etapa 3 — Centro de Recomendações IA Supervisionada &
                  Aprovações Assinadas (SHA-256)
                </CardTitle>
                <Badge variant="default">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  READ_ONLY • 9 Serviços Especializados
                </Badge>
              </div>
              <CardDescription className="mt-1">
                Modelos de IA jamais alteram campanhas reais. Toda recomendação
                passa por Zod + PolicyEngine + RiskEngine + aprovação humana
                vinculada ao hash SHA-256 do payload.
              </CardDescription>
            </div>

            <Button
              type="button"
              size="sm"
              disabled={busyAction !== null || isDemoEnvironment}
              onClick={handleRunAIAnalysis}
              data-testid="run-supervised-ai-analysis-btn"
            >
              <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
              {busyAction === "analyze"
                ? "Analisando métricas..."
                : "Executar 9 Analisadores IA"}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {errorMessage && (
            <div
              role="alert"
              data-testid="ai-center-error-alert"
              className="rounded-lg border border-red-500/40 bg-red-950/60 px-3 py-2 text-xs text-red-100"
            >
              {errorMessage}
            </div>
          )}

          {statusMessage && (
            <div
              role="status"
              data-testid="ai-center-success-status"
              className="rounded-lg border border-emerald-500/40 bg-emerald-950/60 px-3 py-2 text-xs text-emerald-100"
            >
              {statusMessage}
            </div>
          )}

          {recommendations.length === 0 ? (
            <div
              data-testid="ai-recommendations-empty-state"
              className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-8 text-center text-xs text-slate-600 dark:text-slate-300"
            >
              Nenhuma recomendação operacional persistida para esta organização.
              Sincronize campanhas e clique em &ldquo;Executar 9 Analisadores
              IA&rdquo; para gerar recomendações auditáveis.
            </div>
          ) : (
            <div className="space-y-3">
              {recommendations.map((rec) => {
                const riskVariant =
                  rec.riskLevel === "LOW"
                    ? "success"
                    : rec.riskLevel === "MEDIUM"
                      ? "warning"
                      : "destructive";

                return (
                  <div
                    key={rec.id}
                    data-testid={`persisted-rec-card-${rec.id}`}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-4 space-y-3 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">
                            {rec.analyzerService}
                          </Badge>
                          <Badge variant={riskVariant}>
                            Risco: {rec.riskLevel}
                          </Badge>
                          <Badge
                            variant={
                              rec.status === "APPROVED"
                                ? "success"
                                : rec.status === "REJECTED"
                                  ? "secondary"
                                  : "default"
                            }
                          >
                            {rec.status}
                          </Badge>
                          <span className="text-slate-600 dark:text-slate-300">
                            {rec.clientName} • {rec.campaignName}
                          </span>
                        </div>
                        <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                          {rec.title}
                        </h4>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-cyan-700 dark:text-cyan-300 bg-cyan-950/30 border border-cyan-600/30 rounded px-2 py-1">
                        <Fingerprint
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span>
                          SHA-256: {rec.actionPayloadHash.slice(0, 14)}...
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1 text-slate-700 dark:text-slate-200">
                      <p>
                        <strong>Diagnóstico:</strong> {rec.diagnosis}
                      </p>
                      <p>
                        <strong>Justificativa:</strong> {rec.justification}
                      </p>
                      <p>
                        <strong>Ação Proposta ({rec.proposedActionType}):</strong>{" "}
                        {String(
                          rec.evidence._proposedActionSummary ??
                            rec.proposedActionType
                        )}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                        <ShieldCheck
                          className="h-3.5 w-3.5 text-cyan-400"
                          aria-hidden="true"
                        />
                        <span>
                          ApprovalRecord assinado no PostgreSQL • Execução
                          externa bloqueada (READ_ONLY)
                        </span>
                      </div>

                      {rec.status === "APPROVED" ? (
                        <Badge variant="success">
                          <CheckCircle2
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          Aprovado (Payload Hash Assinado)
                        </Badge>
                      ) : rec.status === "REJECTED" ? (
                        <Badge variant="secondary">
                          <XCircle
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          Rejeitado pelo Gestor
                        </Badge>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busyAction !== null}
                            onClick={() =>
                              handleReviewDecision(rec.id, "REJECTED")
                            }
                            data-testid={`reject-rec-btn-${rec.id}`}
                          >
                            Rejeitar
                          </Button>
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            disabled={busyAction !== null || emergencyStopActive}
                            onClick={() =>
                              handleReviewDecision(rec.id, "APPROVED")
                            }
                            data-testid={`approve-rec-btn-${rec.id}`}
                          >
                            {emergencyStopActive ? (
                              <>
                                <AlertTriangle
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                Suspenso por Kill Switch
                              </>
                            ) : (
                              "Aprovar (Assinar SHA-256)"
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card id="executive-reports">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <FileText
                  className="h-5 w-5 text-cyan-400"
                  aria-hidden="true"
                />
                <CardTitle className="text-base">
                  Relatórios Executivos Automatizados para Clientes (
                  <code>REPORT_GENERATOR</code>)
                </CardTitle>
              </div>
              <CardDescription className="mt-1">
                Consolidação auditável de métricas reais do PostgreSQL com
                resumo executivo, destaques, alertas e próximos passos.
              </CardDescription>
            </div>
            <Badge variant="secondary">{reports.length} relatório(s)</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <form
            onSubmit={handleGenerateReport}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 text-xs"
          >
            <div>
              <label
                htmlFor="report-client-select"
                className="block text-[11px] font-medium mb-1"
              >
                Cliente
              </label>
              <select
                id="report-client-select"
                data-testid="report-client-select"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
              >
                {clients.length === 0 ? (
                  <option value="">Nenhum cliente cadastrado</option>
                ) : (
                  clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label
                htmlFor="report-period-start"
                className="block text-[11px] font-medium mb-1"
              >
                Início do Período
              </label>
              <input
                id="report-period-start"
                data-testid="report-period-start-input"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="report-period-end"
                className="block text-[11px] font-medium mb-1"
              >
                Fim do Período
              </label>
              <input
                id="report-period-end"
                data-testid="report-period-end-input"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
              />
            </div>

            <div className="flex items-end">
              <Button
                type="submit"
                size="sm"
                disabled={
                  busyAction !== null ||
                  isDemoEnvironment ||
                  clients.length === 0
                }
                data-testid="generate-executive-report-btn"
                className="w-full h-9"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                {busyAction === "report"
                  ? "Gerando Relatório..."
                  : "Gerar Relatório Executivo"}
              </Button>
            </div>
          </form>

          {reports.length === 0 ? (
            <div
              data-testid="executive-reports-empty-state"
              className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-8 text-center text-xs text-slate-600 dark:text-slate-300"
            >
              Nenhum relatório executivo persistido para esta organização.
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((rep) => (
                <article
                  key={rep.id}
                  data-testid={`executive-report-card-${rep.id}`}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4
                      data-testid={`executive-report-title-${rep.id}`}
                      className="font-semibold text-sm text-slate-900 dark:text-slate-100"
                    >
                      {rep.title}
                    </h4>
                    <Badge variant="default">
                      {rep.periodStart} → {rep.periodEnd}
                    </Badge>
                  </div>
                  <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                    {rep.executiveSummary}
                  </p>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap justify-between gap-2">
                    <span>Cliente: {rep.clientName}</span>
                    <span>
                      Modo:{" "}
                      <code>
                        {String(
                          rep.metricsSnapshot.generationMode ?? "PERSISTED"
                        )}
                      </code>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
