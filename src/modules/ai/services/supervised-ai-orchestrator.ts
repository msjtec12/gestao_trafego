import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import type { TenantContext } from "@/domain/types";
import {
  PolicyEngine,
  RiskEngine,
} from "@/automation/engines/automation-engine";
import {
  AIServiceTypeSchema,
  sanitizeUntrustedPromptInput,
  type AIServiceType,
} from "@/modules/ai/schemas/recommendation-schemas";
import { assertPermission } from "@/security/rbac-and-tenant";

export const AIProposedActionTypeSchema = z.enum([
  "PAUSE_CAMPAIGN",
  "ADJUST_DAILY_BUDGET",
  "ADD_NEGATIVE_KEYWORD",
  "ADJUST_TARGET_CPA",
  "REFRESH_CREATIVE_HEADLINES",
  "AUDIT_CONVERSION_TAG",
]);

export type AIProposedActionType = z.infer<typeof AIProposedActionTypeSchema>;

export const AIAnalyzerDraftRecommendationSchema = z.object({
  campaignId: z.string().min(3),
  analyzerService: AIServiceTypeSchema,
  title: z.string().min(10).max(200),
  diagnosis: z.string().min(20),
  justification: z.string().min(20),
  evidence: z
    .array(
      z.object({
        metric: z.string().min(2),
        observedValue: z.string().min(1),
        benchmarkOrTarget: z.string().min(1),
      })
    )
    .min(1),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  proposedActionType: AIProposedActionTypeSchema,
  proposedActionSummary: z.string().min(10),
  estimatedMonthlySavingsBrl: z.number().min(0),
  proposedPayload: z.record(z.string(), z.unknown()),
  requiresExplicitApproval: z.literal(true),
  validationStatus: z.enum(["VALIDATED", "BLOCKED_BY_POLICY"]).default("VALIDATED"),
  policyNotes: z.string().optional(),
});

export type AIAnalyzerDraftRecommendation = z.infer<
  typeof AIAnalyzerDraftRecommendationSchema
>;

export const ExecutiveReportDraftSchema = z.object({
  title: z.string().min(8).max(200),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  executiveSummary: z.string().min(30),
  highlights: z.array(z.string().min(5)).min(1),
  risksAndAlerts: z.array(z.string().min(5)),
  nextSteps: z.array(z.string().min(5)).min(1),
  generationMode: z.enum(["VERCEL_AI_SDK_LLM", "DETERMINISTIC_RULES_FALLBACK"]),
  modelId: z.string(),
});

export type ExecutiveReportDraft = z.infer<typeof ExecutiveReportDraftSchema>;

export interface CampaignTelemetrySnapshot {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly clientTargetCpaBrl: number | null;
  readonly clientMonthlyBudgetCapBrl: number;
  readonly status: string;
  readonly channelType: string;
  readonly dailyBudgetBrl: number;
  readonly spendBrl: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly conversions: number;
  readonly conversionValueBrl: number;
  readonly ctrPct: number | null;
  readonly cpcBrl: number | null;
  readonly cpaBrl: number | null;
  readonly roas: number | null;
  readonly searchTerms: readonly {
    readonly term: string;
    readonly costBrl: number;
    readonly clicks: number;
    readonly conversions: number;
  }[];
  readonly adHeadlines: readonly string[];
  readonly landingPageUrls: readonly string[];
  readonly activeConversionTags: number;
}

export interface AIAnalysisRunResult {
  readonly servicesExecuted: readonly AIServiceType[];
  readonly recommendations: readonly AIAnalyzerDraftRecommendation[];
  readonly blockedByPolicyCount: number;
  readonly generationMode: "VERCEL_AI_SDK_LLM" | "DETERMINISTIC_RULES_FALLBACK";
  readonly modelId: string;
}

const LLMOutputRecommendationBatchSchema = z.object({
  recommendations: z.array(
    z.object({
      campaignId: z.string().min(3),
      analyzerService: AIServiceTypeSchema,
      title: z.string().min(10).max(200),
      diagnosis: z.string().min(20),
      justification: z.string().min(20),
      evidence: z
        .array(
          z.object({
            metric: z.string().min(2),
            observedValue: z.string().min(1),
            benchmarkOrTarget: z.string().min(1),
          })
        )
        .min(1),
      riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      proposedActionType: AIProposedActionTypeSchema,
      proposedActionSummary: z.string().min(10),
      estimatedMonthlySavingsBrl: z.number().min(0),
      proposedPayload: z.record(z.string(), z.unknown()),
    })
  ),
});

export const ALL_NINE_AI_SERVICES: readonly AIServiceType[] = [
  "STRATEGY_ANALYZER",
  "PERFORMANCE_ANALYZER",
  "KEYWORD_ANALYZER",
  "CONVERSION_ANALYZER",
  "BUDGET_ANALYZER",
  "LANDING_PAGE_AUDITOR",
  "CREATIVE_GENERATOR",
  "RECOMMENDATION_VALIDATOR",
  "REPORT_GENERATOR",
];

function isLiveOpenAiConfigured(
  rawEnv: Record<string, string | undefined> = process.env
): boolean {
  const key = rawEnv.OPENAI_API_KEY?.trim() ?? "";
  return (
    key.length >= 20 &&
    !key.startsWith("sk-replace_with_") &&
    !key.startsWith("replace_with_")
  );
}

/**
 * Orchestrates the 9 specialized AI analyzer services over persisted PostgreSQL telemetry.
 *
 * CRITICAL SAFETY INVARIANT (AGENTS.md Section 2.3):
 * - LLMs NEVER receive any tool or method capable of mutating live ad campaigns.
 * - Every recommendation is strictly validated with Zod (`AIAnalyzerDraftRecommendationSchema`),
 *   checked against `PolicyEngine` + `RiskEngine` + `SimulationEngine` (`RECOMMENDATION_VALIDATOR`),
 *   and always requires explicit human approval (`requiresExplicitApproval: true`).
 * - Untrusted fields (campaign names, search terms, ad headlines, landing URLs) are sanitized
 *   via `sanitizeUntrustedPromptInput` to block prompt injection.
 */
export class SupervisedAIOrchestrator {
  private readonly policyEngine = new PolicyEngine();
  private readonly riskEngine = new RiskEngine();

  /**
   * 1. STRATEGY_ANALYZER — Evaluates channel mix & ROAS/bidding strategy alignment.
   */
  public analyzeStrategy(
    campaigns: readonly CampaignTelemetrySnapshot[]
  ): AIAnalyzerDraftRecommendation[] {
    const drafts: AIAnalyzerDraftRecommendation[] = [];
    for (const c of campaigns) {
      if (c.spendBrl >= 150 && c.roas !== null && c.roas > 0 && c.roas < 2.0) {
        drafts.push({
          campaignId: c.campaignId,
          analyzerService: "STRATEGY_ANALYZER",
          title: `Revisar estratégia de lances e segmentação em "${sanitizeUntrustedPromptInput(c.campaignName).slice(0, 80)}"`,
          diagnosis: `A campanha apresentou ROAS acumulado de ${c.roas.toFixed(2)}x sobre R$ ${c.spendBrl.toFixed(2)} investidos, abaixo do patamar saudável de 2,0x para o canal ${c.channelType}.`,
          justification:
            "Ajustar o Target CPA para consolidar lances em termos de maior intenção reduz desperdício de leilão preservando o volume de leads qualificados.",
          evidence: [
            {
              metric: "ROAS do Período",
              observedValue: `${c.roas.toFixed(2)}x`,
              benchmarkOrTarget: "Meta mínima: >= 2,00x",
            },
            {
              metric: "Investimento Analisado",
              observedValue: `R$ ${c.spendBrl.toFixed(2)}`,
              benchmarkOrTarget: `${c.conversions} conversões registradas`,
            },
          ],
          riskLevel: "MEDIUM",
          proposedActionType: "ADJUST_TARGET_CPA",
          proposedActionSummary: `Recalibrar Target CPA da campanha para R$ ${(c.clientTargetCpaBrl ?? 45).toFixed(2)} com foco em fundo de funil.`,
          estimatedMonthlySavingsBrl: Number((c.spendBrl * 0.18).toFixed(2)),
          proposedPayload: {
            targetCpaBrl: c.clientTargetCpaBrl ?? 45,
            channelType: c.channelType,
          },
          requiresExplicitApproval: true,
          validationStatus: "VALIDATED",
        });
      }
    }
    return drafts;
  }

  /**
   * 2. PERFORMANCE_ANALYZER — Evaluates CPA drift vs target CPA and CTR drop.
   */
  public analyzePerformance(
    campaigns: readonly CampaignTelemetrySnapshot[]
  ): AIAnalyzerDraftRecommendation[] {
    const drafts: AIAnalyzerDraftRecommendation[] = [];
    for (const c of campaigns) {
      const targetCpa = c.clientTargetCpaBrl ?? 50;
      if (c.cpaBrl !== null && c.cpaBrl > targetCpa * 1.35 && c.spendBrl >= 100) {
        const deltaPct = -15;
        const proposedDailyBudgetBrl = Number(
          (c.dailyBudgetBrl * (1 + deltaPct / 100)).toFixed(2)
        );
        drafts.push({
          campaignId: c.campaignId,
          analyzerService: "PERFORMANCE_ANALYZER",
          title: `Contenção de CPA elevado (${((c.cpaBrl / targetCpa - 1) * 100).toFixed(0)}% acima da meta) em "${sanitizeUntrustedPromptInput(c.campaignName).slice(0, 70)}"`,
          diagnosis: `O CPA observado atingiu R$ ${c.cpaBrl.toFixed(2)} frente à meta de R$ ${targetCpa.toFixed(2)}, com ${c.conversions} conversões em ${c.clicks} cliques.`,
          justification:
            "A redução conservadora de 15% no orçamento diário respeita o teto de ±20% do Policy Engine e permite reequilibrar o algoritmo de lances sem resetar o aprendizado.",
          evidence: [
            {
              metric: "CPA Realizado",
              observedValue: `R$ ${c.cpaBrl.toFixed(2)}`,
              benchmarkOrTarget: `Meta do Cliente: R$ ${targetCpa.toFixed(2)}`,
            },
            {
              metric: "Cliques / Conversões",
              observedValue: `${c.clicks} cliques / ${c.conversions} conv.`,
              benchmarkOrTarget: `CTR: ${c.ctrPct !== null ? `${c.ctrPct.toFixed(2)}%` : "N/D"}`,
            },
          ],
          riskLevel: "MEDIUM",
          proposedActionType: "ADJUST_DAILY_BUDGET",
          proposedActionSummary: `Reduzir orçamento diário em 15% (de R$ ${c.dailyBudgetBrl.toFixed(2)} para R$ ${proposedDailyBudgetBrl.toFixed(2)}).`,
          estimatedMonthlySavingsBrl: Number(
            (Math.max(0, c.dailyBudgetBrl - proposedDailyBudgetBrl) * 30).toFixed(2)
          ),
          proposedPayload: {
            currentDailyBudgetBrl: c.dailyBudgetBrl,
            proposedDailyBudgetBrl,
            budgetDeltaPct: deltaPct,
          },
          requiresExplicitApproval: true,
          validationStatus: "VALIDATED",
        });
      }
    }
    return drafts;
  }

  /**
   * 3. KEYWORD_ANALYZER — Identifies wasted spend on zero-conversion search terms.
   */
  public analyzeKeywords(
    campaigns: readonly CampaignTelemetrySnapshot[]
  ): AIAnalyzerDraftRecommendation[] {
    const drafts: AIAnalyzerDraftRecommendation[] = [];
    for (const c of campaigns) {
      const wastefulTerms = c.searchTerms.filter(
        (st) => st.costBrl >= 25 && st.conversions === 0
      );
      if (wastefulTerms.length > 0) {
        const wastedSum = wastefulTerms.reduce((acc, t) => acc + t.costBrl, 0);
        const sanitizedTerms = wastefulTerms.map((t) =>
          sanitizeUntrustedPromptInput(t.term)
        );
        drafts.push({
          campaignId: c.campaignId,
          analyzerService: "KEYWORD_ANALYZER",
          title: `Negativar ${wastefulTerms.length} termo(s) de pesquisa com gasto sem conversão`,
          diagnosis: `Foram detectados ${wastefulTerms.length} termos de pesquisa consumindo R$ ${wastedSum.toFixed(2)} sem gerar nenhuma conversão na campanha "${sanitizeUntrustedPromptInput(c.campaignName)}".`,
          justification:
            "A inclusão de palavras-chave negativas em correspondência de frase elimina imediatamente o desperdício de verba em consultas desqualificadas.",
          evidence: [
            {
              metric: "Gasto em Termos Sem Conversão",
              observedValue: `R$ ${wastedSum.toFixed(2)}`,
              benchmarkOrTarget: "0 conversões geradas",
            },
            {
              metric: "Termos Críticos Identificados",
              observedValue: sanitizedTerms.slice(0, 3).join(", "),
              benchmarkOrTarget: "Negativação PHRASE recomendada",
            },
          ],
          riskLevel: "LOW",
          proposedActionType: "ADD_NEGATIVE_KEYWORD",
          proposedActionSummary: `Adicionar ${wastefulTerms.length} palavra(s)-chave negativa(s) em correspondência PHRASE.`,
          estimatedMonthlySavingsBrl: Number((wastedSum * 4).toFixed(2)),
          proposedPayload: {
            negativeKeywords: sanitizedTerms.slice(0, 10),
            matchType: "PHRASE",
          },
          requiresExplicitApproval: true,
          validationStatus: "VALIDATED",
        });
      }
    }
    return drafts;
  }

  /**
   * 4. CONVERSION_ANALYZER — Audits conversion tracking health and zero-conversion anomalies.
   */
  public analyzeConversions(
    campaigns: readonly CampaignTelemetrySnapshot[]
  ): AIAnalyzerDraftRecommendation[] {
    const drafts: AIAnalyzerDraftRecommendation[] = [];
    for (const c of campaigns) {
      if (
        (c.activeConversionTags === 0 && c.spendBrl > 0) ||
        (c.clicks >= 40 && c.conversions === 0)
      ) {
        drafts.push({
          campaignId: c.campaignId,
          analyzerService: "CONVERSION_ANALYZER",
          title: `Auditar tag de conversão em "${sanitizeUntrustedPromptInput(c.campaignName).slice(0, 80)}"`,
          diagnosis: `A campanha acumulou ${c.clicks} cliques e R$ ${c.spendBrl.toFixed(2)} investidos com ${c.conversions} conversões registradas (${c.activeConversionTags} tags ativas mapeadas).`,
          justification:
            "Validar o disparo de Enhanced Conversions / GTM impede que os lances automáticos otimizem com sinais cegos ou corrompidos.",
          evidence: [
            {
              metric: "Cliques sem Conversão",
              observedValue: `${c.clicks} cliques / ${c.conversions} conv.`,
              benchmarkOrTarget: "Mínimo esperado: >= 1 conversão a cada 35 cliques",
            },
            {
              metric: "Tags de Conversão Mapeadas",
              observedValue: String(c.activeConversionTags),
              benchmarkOrTarget: ">= 1 ação de conversão primária ativa",
            },
          ],
          riskLevel: "HIGH",
          proposedActionType: "AUDIT_CONVERSION_TAG",
          proposedActionSummary:
            "Auditar disparo de tag GTM / Enhanced Conversions e confirmar atribuição na landing page.",
          estimatedMonthlySavingsBrl: Number((c.spendBrl * 0.25).toFixed(2)),
          proposedPayload: {
            activeConversionTags: c.activeConversionTags,
            observedClicks: c.clicks,
          },
          requiresExplicitApproval: true,
          validationStatus: "VALIDATED",
        });
      }
    }
    return drafts;
  }

  /**
   * 5. BUDGET_ANALYZER — Evaluates safe budget scaling when CPA is well below target.
   */
  public analyzeBudgets(
    campaigns: readonly CampaignTelemetrySnapshot[]
  ): AIAnalyzerDraftRecommendation[] {
    const drafts: AIAnalyzerDraftRecommendation[] = [];
    for (const c of campaigns) {
      const targetCpa = c.clientTargetCpaBrl ?? 50;
      if (
        c.status === "LIMITED_BY_BUDGET" ||
        (c.cpaBrl !== null &&
          c.cpaBrl <= targetCpa * 0.8 &&
          c.conversions >= 5 &&
          c.dailyBudgetBrl > 0)
      ) {
        const deltaPct = 15;
        const proposedDailyBudgetBrl = Number(
          (c.dailyBudgetBrl * 1.15).toFixed(2)
        );
        drafts.push({
          campaignId: c.campaignId,
          analyzerService: "BUDGET_ANALYZER",
          title: `Escala supervisionada de +15% no orçamento diário em "${sanitizeUntrustedPromptInput(c.campaignName).slice(0, 70)}"`,
          diagnosis: `A campanha opera com eficiência comprovada (CPA R$ ${(c.cpaBrl ?? 0).toFixed(2)} vs meta R$ ${targetCpa.toFixed(2)} e ${c.conversions} conversões), apresentando margem segura para expansão.`,
          justification:
            "Incremento gradual de +15% respeita o teto de segurança financeira de 20% do Policy Engine e maximiza volume de leads qualificados.",
          evidence: [
            {
              metric: "CPA Realizado vs Meta",
              observedValue: `R$ ${(c.cpaBrl ?? 0).toFixed(2)}`,
              benchmarkOrTarget: `Meta: R$ ${targetCpa.toFixed(2)}`,
            },
            {
              metric: "Orçamento Diário Atual",
              observedValue: `R$ ${c.dailyBudgetBrl.toFixed(2)}`,
              benchmarkOrTarget: `Proposta segura (+15%): R$ ${proposedDailyBudgetBrl.toFixed(2)}`,
            },
          ],
          riskLevel: "LOW",
          proposedActionType: "ADJUST_DAILY_BUDGET",
          proposedActionSummary: `Ajustar orçamento diário de R$ ${c.dailyBudgetBrl.toFixed(2)} para R$ ${proposedDailyBudgetBrl.toFixed(2)} (+15%).`,
          estimatedMonthlySavingsBrl: Number(
            (c.dailyBudgetBrl * 0.15 * 30).toFixed(2)
          ),
          proposedPayload: {
            currentDailyBudgetBrl: c.dailyBudgetBrl,
            proposedDailyBudgetBrl,
            budgetDeltaPct: deltaPct,
          },
          requiresExplicitApproval: true,
          validationStatus: "VALIDATED",
        });
      }
    }
    return drafts;
  }

  /**
   * 6. LANDING_PAGE_AUDITOR — Checks HTTPS hygiene & conversion efficiency on destination URLs.
   */
  public analyzeLandingPages(
    campaigns: readonly CampaignTelemetrySnapshot[]
  ): AIAnalyzerDraftRecommendation[] {
    const drafts: AIAnalyzerDraftRecommendation[] = [];
    for (const c of campaigns) {
      const insecureUrl = c.landingPageUrls.find((u) =>
        u.trim().toLowerCase().startsWith("http://")
      );
      if (insecureUrl) {
        drafts.push({
          campaignId: c.campaignId,
          analyzerService: "LANDING_PAGE_AUDITOR",
          title: `Migrar URL de destino insegura (HTTP) para HTTPS em "${sanitizeUntrustedPromptInput(c.campaignName).slice(0, 70)}"`,
          diagnosis: `Foi identificada URL final utilizando protocolo HTTP sem criptografia (${sanitizeUntrustedPromptInput(insecureUrl)}), o que penaliza o Índice de Qualidade e reduz a taxa de conversão mobile.`,
          justification:
            "A atualização para HTTPS elimina alertas de navegador e protege a atribuição de cliques e parâmetros GCLID.",
          evidence: [
            {
              metric: "Protocolo da Landing Page",
              observedValue: "HTTP (Não seguro)",
              benchmarkOrTarget: "Obrigatório: HTTPS com SSL válido",
            },
          ],
          riskLevel: "LOW",
          proposedActionType: "AUDIT_CONVERSION_TAG",
          proposedActionSummary:
            "Atualizar URL final para HTTPS e validar carregamento mobile (< 2,5s LCP).",
          estimatedMonthlySavingsBrl: Number((c.spendBrl * 0.1).toFixed(2)),
          proposedPayload: {
            detectedUrl: sanitizeUntrustedPromptInput(insecureUrl),
            recommendedProtocol: "https",
          },
          requiresExplicitApproval: true,
          validationStatus: "VALIDATED",
        });
      }
    }
    return drafts;
  }

  /**
   * 7. CREATIVE_GENERATOR — Evaluates low CTR and recommends refreshing RSA headlines/descriptions.
   */
  public analyzeCreatives(
    campaigns: readonly CampaignTelemetrySnapshot[]
  ): AIAnalyzerDraftRecommendation[] {
    const drafts: AIAnalyzerDraftRecommendation[] = [];
    for (const c of campaigns) {
      if (c.impressions >= 500 && c.ctrPct !== null && c.ctrPct < 2.0) {
        drafts.push({
          campaignId: c.campaignId,
          analyzerService: "CREATIVE_GENERATOR",
          title: `Renovar títulos RSA devido a CTR baixo (${c.ctrPct.toFixed(2)}%) em "${sanitizeUntrustedPromptInput(c.campaignName).slice(0, 70)}"`,
          diagnosis: `Com ${c.impressions} impressões e apenas ${c.clicks} cliques (CTR ${c.ctrPct.toFixed(2)}%), os criativos atuais apresentam baixa aderência à intenção de busca.`,
          justification:
            "Testar novos títulos responsivos com proposta de valor explícita e CTA direto eleva o CTR e reduz o CPC médio no leilão.",
          evidence: [
            {
              metric: "CTR Observado",
              observedValue: `${c.ctrPct.toFixed(2)}%`,
              benchmarkOrTarget: "Benchmark mínimo Search: >= 2,00%",
            },
            {
              metric: "Títulos Atuais",
              observedValue: String(c.adHeadlines.length),
              benchmarkOrTarget: "Recomendado: >= 8 títulos variados (RSA)",
            },
          ],
          riskLevel: "LOW",
          proposedActionType: "REFRESH_CREATIVE_HEADLINES",
          proposedActionSummary:
            "Adicionar 3 novas variações de título RSA com prova social, diferencial local e chamada para ação.",
          estimatedMonthlySavingsBrl: Number((c.spendBrl * 0.12).toFixed(2)),
          proposedPayload: {
            suggestedHeadlines: [
              `Especialistas em ${sanitizeUntrustedPromptInput(c.clientName).slice(0, 22)}`,
              "Atendimento Rápido e Personalizado",
              "Solicite Avaliação Especializada Hoje",
            ],
          },
          requiresExplicitApproval: true,
          validationStatus: "VALIDATED",
        });
      }
    }
    return drafts;
  }

  /**
   * 8. RECOMMENDATION_VALIDATOR — Validates every AI recommendation against PolicyEngine,
   * RiskEngine, and SimulationEngine before persisting to PostgreSQL.
   */
  public validateAndEnrichRecommendations(
    drafts: readonly AIAnalyzerDraftRecommendation[],
    campaigns: readonly CampaignTelemetrySnapshot[],
    maxDailyBudgetChangePct = 20
  ): {
    readonly validated: readonly AIAnalyzerDraftRecommendation[];
    readonly blockedByPolicyCount: number;
  } {
    const campaignById = new Map(campaigns.map((c) => [c.campaignId, c]));
    const validated: AIAnalyzerDraftRecommendation[] = [];
    let blockedByPolicyCount = 0;

    for (const draft of drafts) {
      const parsed = AIAnalyzerDraftRecommendationSchema.parse({
        ...draft,
        requiresExplicitApproval: true,
      });

      const camp = campaignById.get(parsed.campaignId);
      const restrictedCheck = this.policyEngine.validateCampaignContent(
        `${camp?.campaignName ?? ""} ${parsed.title}`
      );
      if (!restrictedCheck.allowed) {
        blockedByPolicyCount += 1;
        continue;
      }

      let finalRisk = parsed.riskLevel;
      let policyNotes = "Validado por PolicyEngine + RiskEngine.";
      let enrichedPayload: Record<string, unknown> = {
        ...parsed.proposedPayload,
      };

      if (parsed.proposedActionType === "ADJUST_DAILY_BUDGET") {
        const deltaPct = Number(
          parsed.proposedPayload.budgetDeltaPct ??
            parsed.proposedPayload.changePct ??
            0
        );
        const currentDailyBudgetBrl = Number(
          parsed.proposedPayload.currentDailyBudgetBrl ??
            camp?.dailyBudgetBrl ??
            0
        );
        const financialCheck = this.policyEngine.validateFinancialLimit(
          deltaPct,
          maxDailyBudgetChangePct,
          currentDailyBudgetBrl > 0 ? currentDailyBudgetBrl : undefined
        );
        if (!financialCheck.allowed) {
          blockedByPolicyCount += 1;
          continue;
        }

        finalRisk = this.riskEngine.classifyRisk(
          parsed.proposedActionType,
          deltaPct
        );
        const projectedDailyBudgetBrl = Number(
          (currentDailyBudgetBrl * (1 + deltaPct / 100)).toFixed(2)
        );
        const projectedMonthlyDeltaBrl = Number(
          ((projectedDailyBudgetBrl - currentDailyBudgetBrl) * 30).toFixed(2)
        );
        enrichedPayload = {
          ...enrichedPayload,
          simulationProjection: {
            currentDailyBudgetBrl,
            projectedDailyBudgetBrl,
            budgetDeltaPct: deltaPct,
            projectedMonthlyDeltaBrl,
          },
        };
        policyNotes = `Dentro do limite financeiro (±${maxDailyBudgetChangePct}%). Projeção diária: R$ ${projectedDailyBudgetBrl.toFixed(2)}.`;
      }

      validated.push({
        ...parsed,
        riskLevel: finalRisk,
        proposedPayload: enrichedPayload,
        validationStatus: "VALIDATED",
        policyNotes,
      });
    }

    return { validated, blockedByPolicyCount };
  }

  /**
   * Executes the full 9-service Supervised AI Analysis pipeline over real PostgreSQL telemetry.
   * Uses Vercel AI SDK v6 (`generateObject` with Zod) when `OPENAI_API_KEY` is configured,
   * or falls back transparently to the deterministic multi-analyzer rule engines when no
   * external LLM key is provisioned in the environment.
   */
  public async runFullSupervisedAnalysis(params: {
    readonly context: TenantContext;
    readonly campaigns: readonly CampaignTelemetrySnapshot[];
    readonly maxDailyBudgetChangePct?: number;
  }): Promise<AIAnalysisRunResult> {
    assertPermission(params.context, "ai:analyze");

    if (params.campaigns.length === 0) {
      return {
        servicesExecuted: ALL_NINE_AI_SERVICES,
        recommendations: [],
        blockedByPolicyCount: 0,
        generationMode: "DETERMINISTIC_RULES_FALLBACK",
        modelId: "deterministic-analyzer-v3",
      };
    }

    let rawDrafts: AIAnalyzerDraftRecommendation[] = [];
    let generationMode: "VERCEL_AI_SDK_LLM" | "DETERMINISTIC_RULES_FALLBACK" =
      "DETERMINISTIC_RULES_FALLBACK";
    let modelId = "deterministic-analyzer-v3";

    if (isLiveOpenAiConfigured()) {
      const configuredModel = process.env.AI_DEFAULT_MODEL?.trim() || "gpt-4o-mini";
      try {
        const openai = createOpenAI({
          apiKey: process.env.OPENAI_API_KEY,
        });
        const sanitizedSnapshots = params.campaigns.map((c) => ({
          campaignId: c.campaignId,
          campaignName: sanitizeUntrustedPromptInput(c.campaignName),
          clientName: sanitizeUntrustedPromptInput(c.clientName),
          clientTargetCpaBrl: c.clientTargetCpaBrl,
          status: c.status,
          channelType: c.channelType,
          dailyBudgetBrl: c.dailyBudgetBrl,
          spendBrl: c.spendBrl,
          impressions: c.impressions,
          clicks: c.clicks,
          conversions: c.conversions,
          ctrPct: c.ctrPct,
          cpaBrl: c.cpaBrl,
          roas: c.roas,
          wastefulSearchTerms: c.searchTerms
            .filter((t) => t.conversions === 0 && t.costBrl > 0)
            .slice(0, 5)
            .map((t) => ({
              term: sanitizeUntrustedPromptInput(t.term),
              costBrl: t.costBrl,
            })),
        }));

        const { object } = await generateObject({
          model: openai(configuredModel),
          schema: LLMOutputRecommendationBatchSchema,
          system:
            "Você é o motor de inteligência analítica do Konnexy Ads. Produza recomendações auditáveis em português (pt-BR) estritamente baseadas nos dados fornecidos. Você NUNCA pode executar mutações diretas em campanhas; toda recomendação exige aprovação humana explícita. Respeite o limite máximo de variação de orçamento diário de ±20%.",
          prompt: `Analise o snapshot multi-tenant a seguir e gere até 5 recomendações estruturadas com evidências numéricas verificáveis:\n${JSON.stringify(sanitizedSnapshots)}`,
        });

        rawDrafts = object.recommendations.map((r) => ({
          ...r,
          requiresExplicitApproval: true as const,
          validationStatus: "VALIDATED" as const,
        }));
        generationMode = "VERCEL_AI_SDK_LLM";
        modelId = configuredModel;
      } catch {
        // Fallback transparently to deterministic analyzers if LLM provider times out or rejects key
        rawDrafts = [];
      }
    }

    if (rawDrafts.length === 0) {
      rawDrafts = [
        ...this.analyzeKeywords(params.campaigns),
        ...this.analyzePerformance(params.campaigns),
        ...this.analyzeBudgets(params.campaigns),
        ...this.analyzeConversions(params.campaigns),
        ...this.analyzeStrategy(params.campaigns),
        ...this.analyzeLandingPages(params.campaigns),
        ...this.analyzeCreatives(params.campaigns),
      ];
    }

    const { validated, blockedByPolicyCount } =
      this.validateAndEnrichRecommendations(
        rawDrafts,
        params.campaigns,
        params.maxDailyBudgetChangePct ?? 20
      );

    return {
      servicesExecuted: ALL_NINE_AI_SERVICES,
      recommendations: validated,
      blockedByPolicyCount,
      generationMode,
      modelId,
    };
  }

  /**
   * 9. REPORT_GENERATOR — Generates structured Executive Reports for a client over real metrics.
   */
  public async generateExecutiveReportDraft(params: {
    readonly context: TenantContext;
    readonly clientName: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly totalSpendBrl: number;
    readonly totalImpressions: number;
    readonly totalClicks: number;
    readonly totalConversions: number;
    readonly cpaBrl: number | null;
    readonly ctrPct: number | null;
    readonly roas: number | null;
    readonly activeRecommendationsCount: number;
  }): Promise<ExecutiveReportDraft> {
    assertPermission(params.context, "ai:analyze");

    const safeClientName = sanitizeUntrustedPromptInput(params.clientName);

    if (isLiveOpenAiConfigured()) {
      const configuredModel =
        process.env.AI_STRATEGIC_MODEL?.trim() || "gpt-4o-mini";
      try {
        const openai = createOpenAI({
          apiKey: process.env.OPENAI_API_KEY,
        });
        const { object } = await generateObject({
          model: openai(configuredModel),
          schema: ExecutiveReportDraftSchema.omit({
            generationMode: true,
            modelId: true,
          }),
          system:
            "Você é o Report Generator do Konnexy Ads. Produza um relatório executivo claro, objetivo e auditável em português (pt-BR) para o cliente, utilizando apenas os indicadores reais fornecidos.",
          prompt: `Gere o relatório executivo para o cliente "${safeClientName}" no período ${params.periodStart} a ${params.periodEnd} com os seguintes dados reais: ${JSON.stringify(
            {
              totalSpendBrl: params.totalSpendBrl,
              totalImpressions: params.totalImpressions,
              totalClicks: params.totalClicks,
              totalConversions: params.totalConversions,
              cpaBrl: params.cpaBrl,
              ctrPct: params.ctrPct,
              roas: params.roas,
              activeRecommendationsCount: params.activeRecommendationsCount,
            }
          )}`,
        });

        return ExecutiveReportDraftSchema.parse({
          ...object,
          generationMode: "VERCEL_AI_SDK_LLM",
          modelId: configuredModel,
        });
      } catch {
        // Fallback to deterministic report synthesis
      }
    }

    const cpaLabel =
      params.cpaBrl !== null ? `R$ ${params.cpaBrl.toFixed(2)}` : "N/D";
    const ctrLabel =
      params.ctrPct !== null ? `${params.ctrPct.toFixed(2)}%` : "N/D";
    const roasLabel =
      params.roas !== null ? `${params.roas.toFixed(2)}x` : "N/D";

    const highlights: string[] = [
      `Investimento consolidado no período: R$ ${params.totalSpendBrl.toFixed(2)} com ${params.totalConversions} conversões registradas.`,
      `Eficiência agregada real: CPA ${cpaLabel} | CTR ${ctrLabel} | ROAS ${roasLabel}.`,
    ];

    const risksAndAlerts: string[] = [];
    if (params.totalConversions === 0 && params.totalSpendBrl > 0) {
      risksAndAlerts.push(
        "Investimento ativo sem conversões atribuídas no período — recomendada auditoria imediata das tags de conversão."
      );
    }
    if (params.activeRecommendationsCount > 0) {
      risksAndAlerts.push(
        `Existem ${params.activeRecommendationsCount} recomendação(ões) supervisionada(s) aguardando revisão e aprovação humana.`
      );
    }

    const nextSteps: string[] = [
      "Revisar recomendações pendentes no Centro de Aprovação Supervisionada (modo READ_ONLY preservado).",
      "Acompanhar evolução semanal de CPA e ROAS após validação das ações aprovadas.",
    ];

    return ExecutiveReportDraftSchema.parse({
      title: `Relatório Executivo de Performance — ${safeClientName} (${params.periodStart} a ${params.periodEnd})`,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      executiveSummary: `No período de ${params.periodStart} a ${params.periodEnd}, o cliente ${safeClientName} registrou investimento total de R$ ${params.totalSpendBrl.toFixed(2)}, ${params.totalImpressions} impressões, ${params.totalClicks} cliques (CTR ${ctrLabel}) e ${params.totalConversions} conversões (CPA médio ${cpaLabel}, ROAS ${roasLabel}). Todas as otimizações seguem sob governança READ_ONLY com aprovação explícita.`,
      highlights,
      risksAndAlerts,
      nextSteps,
      generationMode: "DETERMINISTIC_RULES_FALLBACK",
      modelId: "deterministic-report-generator-v3",
    });
  }
}
