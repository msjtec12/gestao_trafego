"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  TrendingUp,
  KeyRound,
  Wallet,
  Target,
  Compass,
  Globe,
  FileText,
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
import {
  reviewRecommendationServerAction,
  runSupervisedAIAnalysisServerAction,
} from "@/app/actions/operational-actions";
import type { CommercialClientViewModel } from "@/application/use-cases/operational-workspace-loader";
import type { PersistedRecommendationWithApproval } from "@/infrastructure/db/repositories/ai-recommendations-reports-repository";

const COMMERCIAL_AI_PILLARS = [
  {
    key: "DESEMPENHO",
    title: "Desempenho & Anomalias",
    description:
      "Identifica quedas de CTR, alta súbita de CPA e campanhas com desperdício de verba.",
    icon: TrendingUp,
  },
  {
    key: "PALAVRAS_CHAVE",
    title: "Palavras-chave & Termos",
    description:
      "Detecta termos de pesquisa irrelevantes com gasto sem conversão para negativação.",
    icon: KeyRound,
  },
  {
    key: "ORCAMENTO",
    title: "Orçamento & Pacing",
    description:
      "Monitora consumo acelerado, limitação por verba e realocação entre campanhas.",
    icon: Wallet,
  },
  {
    key: "CONVERSOES",
    title: "Conversões & Rastreamento",
    description:
      "Valida saúde de tags, eventos primários e consistência entre cliques e conversões.",
    icon: Target,
  },
  {
    key: "ESTRATEGIA",
    title: "Estratégia & Escala",
    description:
      "Sinaliza campanhas dentro da meta de CPA/ROAS com margem segura para revisão.",
    icon: Compass,
  },
  {
    key: "LANDING_PAGES",
    title: "Landing Pages",
    description:
      "Cruza cliques qualificados sem conversão com experiência de destino e oferta.",
    icon: Globe,
  },
  {
    key: "ANUNCIOS",
    title: "Anúncios & Criativos",
    description:
      "Analisa fadiga de anúncios, aprovações de política e força dos títulos.",
    icon: FileText,
  },
] as const;

function riskBadgeVariant(
  risk: string
): "success" | "warning" | "destructive" | "secondary" {
  switch (risk) {
    case "LOW":
      return "success";
    case "MEDIUM":
      return "warning";
    case "HIGH":
    case "CRITICAL":
      return "destructive";
    default:
      return "secondary";
  }
}

export function CommercialAICenterClient({
  clients,
  recommendations: initialRecs,
  mode = "AI_CENTER",
}: {
  readonly clients: readonly CommercialClientViewModel[];
  readonly recommendations: readonly PersistedRecommendationWithApproval[];
  readonly mode?: "AI_CENTER" | "RECOMMENDATIONS";
}) {
  const router = useRouter();
  const [recommendations, setRecommendations] =
    React.useState<readonly PersistedRecommendationWithApproval[]>(initialRecs);
  const [selectedClientId, setSelectedClientId] = React.useState(
    clients[0]?.id ?? ""
  );
  const [statusFilter, setStatusFilter] = React.useState("ALL");
  const [running, setRunning] = React.useState(false);
  const [reviewingId, setReviewingId] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleRunAnalysis = async () => {
    setFeedback(null);
    setError(null);
    setRunning(true);
    try {
      const res = await runSupervisedAIAnalysisServerAction({
        clientId: selectedClientId || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível executar a análise.");
        return;
      }
      setFeedback(
        `Análise concluída: ${res.createdCount ?? 0} nova(s) recomendação(ões) gerada(s) com base exclusivamente em métricas reais.`
      );
      router.refresh();
    } finally {
      setRunning(false);
    }
  };

  const handleReview = async (
    recommendationId: string,
    decision: "APPROVED" | "REJECTED"
  ) => {
    setFeedback(null);
    setError(null);
    setReviewingId(recommendationId);
    try {
      const res = await reviewRecommendationServerAction({
        recommendationId,
        decision,
        decisionNotes:
          decision === "APPROVED"
            ? "Aprovado pelo gestor para execução manual na plataforma de anúncios."
            : "Descartado pelo gestor na revisão operacional.",
      });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível registrar a revisão.");
        return;
      }
      setRecommendations((prev) =>
        prev.map((r) =>
          r.id === recommendationId ? { ...r, status: decision } : r
        )
      );
      setFeedback(
        decision === "APPROVED"
          ? "Recomendação aprovada e auditada (modo READ_ONLY: nenhuma alteração automática foi enviada às plataformas)."
          : "Recomendação rejeitada e registrada na trilha de auditoria."
      );
      router.refresh();
    } finally {
      setReviewingId(null);
    }
  };

  const filteredRecs = recommendations.filter((r) => {
    if (statusFilter !== "ALL" && r.status !== statusFilter) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 text-xs flex items-center gap-2.5">
        <ShieldCheck className="h-4 w-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
        <span>
          <strong>IA Supervisionada (Sem Execução Direta):</strong> Todas as
          recomendações são baseadas estritamente em métricas reais persistidas,
          sem previsões inventadas de economia ou crescimento, e{" "}
          <strong>nenhuma alteração real</strong> é executada automaticamente
          nas plataformas de anúncios.
        </span>
      </div>

      {mode === "AI_CENTER" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {COMMERCIAL_AI_PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <Card key={pillar.key}>
                <CardContent className="pt-4 pb-4 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-cyan-500 shrink-0" />
                    <h2 className="text-xs font-semibold">{pillar.title}</h2>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    {pillar.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Action Bar */}
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filtrar cliente para análise de IA"
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
            >
              <option value="">Todos os clientes</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por status de aprovação"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
            >
              <option value="ALL">Todos os status ({recommendations.length})</option>
              <option value="PENDING">Pendentes</option>
              <option value="APPROVED">Aprovadas</option>
              <option value="REJECTED">Rejeitadas</option>
            </select>
          </div>

          <Button
            type="button"
            disabled={running}
            onClick={handleRunAnalysis}
          >
            <Sparkles className="h-4 w-4" />
            {running ? "Analisando dados reais..." : "Executar Análise de IA"}
          </Button>
        </CardContent>
      </Card>

      {feedback && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
        >
          {feedback}
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

      {/* Recommendations List */}
      {filteredRecs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Sparkles className="h-8 w-8 text-slate-400 mx-auto" />
            <p className="text-sm font-medium">
              Nenhuma recomendação disponível para este filtro
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Conecte o Google Ads e sincronize campanhas com métricas reais
              para que os 9 analisadores de IA gerem recomendações fundamentadas
              em evidências.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredRecs.map((rec) => {
            const evidenceEntries = Object.entries(rec.evidence ?? {});
            return (
              <Card key={rec.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{rec.title}</CardTitle>
                      <CardDescription>
                        Cliente: {rec.clientName} · Campanha: {rec.campaignName}{" "}
                        · Analisador: {rec.analyzerService}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={riskBadgeVariant(rec.riskLevel)}>
                        Risco: {rec.riskLevel}
                      </Badge>
                      <Badge
                        variant={
                          rec.status === "APPROVED"
                            ? "success"
                            : rec.status === "REJECTED"
                              ? "destructive"
                              : "warning"
                        }
                      >
                        {rec.status}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg bg-slate-100/80 dark:bg-slate-800/50 p-3 space-y-1">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        Problema encontrado & Evidências
                      </p>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                        {rec.diagnosis}
                      </p>
                      {evidenceEntries.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {evidenceEntries.map(([k, v]) => (
                            <Badge key={k} variant="secondary">
                              {k}: {String(v)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg bg-slate-100/80 dark:bg-slate-800/50 p-3 space-y-1">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        Ação recomendada & Justificativa
                      </p>
                      <p className="font-medium text-cyan-700 dark:text-cyan-300">
                        {rec.proposedActionType}
                      </p>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                        {rec.justification}
                      </p>
                    </div>
                  </div>

                  {rec.status === "PENDING" && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                      <Button
                        type="button"
                        size="sm"
                        disabled={reviewingId === rec.id}
                        onClick={() => handleReview(rec.id, "APPROVED")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Aprovar Recomendação
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={reviewingId === rec.id}
                        onClick={() => handleReview(rec.id, "REJECTED")}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Rejeitar
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
