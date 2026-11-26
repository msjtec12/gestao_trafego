"use client";

import * as React from "react";
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  AlertTriangle,
  Lock,
} from "lucide-react";
import type { AIRecommendation } from "@/modules/ai/schemas/recommendation-schemas";
import { formatCurrencyBrl } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface AIRecommendationsPanelProps {
  readonly recommendations: AIRecommendation[];
  readonly emergencyStopActive: boolean;
}

export function AIRecommendationsPanel({
  recommendations,
  emergencyStopActive,
}: AIRecommendationsPanelProps) {
  const [decisions, setDecisions] = React.useState<
    Record<string, "APPROVED_SIMULATION" | "REJECTED">
  >({});

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-cyan-400" />
            <CardTitle className="text-base">
              Centro de Recomendações IA Supervisionada (Validadas por Zod)
            </CardTitle>
            <Badge variant="demo">DADOS DEMO</Badge>
          </div>
          <Badge variant="default" className="w-fit">
            <Lock className="h-3 w-3" />
            IA proibida de alterar campanhas diretamente
          </Badge>
        </div>
        <CardDescription>
          Cada diagnóstico apresenta evidências verificáveis, justificativa, nível de risco e exige aprovação humana explícita.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {recommendations.map((rec) => {
          const decision = decisions[rec.id];
          const riskBadgeVariant =
            rec.riskLevel === "LOW"
              ? "success"
              : rec.riskLevel === "MEDIUM"
                ? "warning"
                : "destructive";

          return (
            <div
              key={rec.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{rec.analyzerService}</Badge>
                    <Badge variant={riskBadgeVariant}>
                      Risco: {rec.riskLevel}
                    </Badge>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {rec.clientName}
                    </span>
                  </div>
                  <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 mt-1.5">
                    {rec.title}
                  </h4>
                  <p className="text-xs text-cyan-600 dark:text-cyan-400">
                    Campanha: {rec.campaignName}
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 block">
                    Impacto / Economia Projetada
                  </span>
                  <span className="text-sm font-bold text-emerald-500">
                    {formatCurrencyBrl(
                      rec.proposedAction.estimatedMonthlySavingsBrl
                    )}
                    /mês
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {rec.evidence.map((ev) => (
                  <div
                    key={ev.metric}
                    className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950/60 px-3 py-2 text-xs"
                  >
                    <span className="text-slate-400 block">{ev.metric}</span>
                    <div className="flex items-center justify-between mt-0.5">
                      <strong className="text-slate-900 dark:text-slate-100">
                        {ev.observedValue}
                      </strong>
                      <span className="text-[11px] text-slate-400">
                        {ev.benchmarkOrTarget}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="text-xs space-y-1 text-slate-600 dark:text-slate-300">
                <p>
                  <strong className="text-slate-900 dark:text-slate-100">
                    Diagnóstico:
                  </strong>{" "}
                  {rec.diagnosis}
                </p>
                <p>
                  <strong className="text-slate-900 dark:text-slate-100">
                    Justificativa:
                  </strong>{" "}
                  {rec.justification}
                </p>
                <p>
                  <strong className="text-cyan-600 dark:text-cyan-400">
                    Ação Proposta ({rec.proposedAction.actionType}):
                  </strong>{" "}
                  {rec.proposedAction.summary}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
                  <span>
                    Requer Aprovação Explícita • Modo Padrão: SOMENTE LEITURA
                  </span>
                </div>

                {decision === "APPROVED_SIMULATION" ? (
                  <Badge variant="success">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Simulação Aprovada no Sandbox (Nenhuma campanha real alterada)
                  </Badge>
                ) : decision === "REJECTED" ? (
                  <Badge variant="secondary">
                    <XCircle className="h-3.5 w-3.5" />
                    Recomendação Descartada pelo Gestor
                  </Badge>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDecisions((prev) => ({
                          ...prev,
                          [rec.id]: "REJECTED",
                        }))
                      }
                    >
                      Rejeitar
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={emergencyStopActive}
                      onClick={() =>
                        setDecisions((prev) => ({
                          ...prev,
                          [rec.id]: "APPROVED_SIMULATION",
                        }))
                      }
                    >
                      {emergencyStopActive ? (
                        <>
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Suspenso por Kill Switch
                        </>
                      ) : (
                        "Aprovar Simulação (Sandbox)"
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
