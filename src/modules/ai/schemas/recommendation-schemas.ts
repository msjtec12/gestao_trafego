import { z } from "zod";

export const AIServiceTypeSchema = z.enum([
  "STRATEGY_ANALYZER",
  "PERFORMANCE_ANALYZER",
  "KEYWORD_ANALYZER",
  "CONVERSION_ANALYZER",
  "BUDGET_ANALYZER",
  "LANDING_PAGE_AUDITOR",
  "CREATIVE_GENERATOR",
  "RECOMMENDATION_VALIDATOR",
  "REPORT_GENERATOR",
]);

export type AIServiceType = z.infer<typeof AIServiceTypeSchema>;

export const AIRecommendationSchema = z.object({
  id: z.string().min(3),
  organizationId: z.string().min(3),
  campaignId: z.string().min(3),
  campaignName: z.string().min(3),
  clientName: z.string().min(2),
  analyzerService: AIServiceTypeSchema,
  title: z.string().min(10).max(200),
  evidence: z.array(
    z.object({
      metric: z.string().min(2),
      observedValue: z.string().min(1),
      benchmarkOrTarget: z.string().min(1),
    })
  ).min(1),
  diagnosis: z.string().min(20),
  justification: z.string().min(20),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  proposedAction: z.object({
    actionType: z.enum([
      "PAUSE_CAMPAIGN",
      "ADJUST_DAILY_BUDGET",
      "ADD_NEGATIVE_KEYWORD",
      "ADJUST_TARGET_CPA",
      "REFRESH_CREATIVE_HEADLINES",
      "AUDIT_CONVERSION_TAG",
    ]),
    summary: z.string().min(10),
    estimatedMonthlySavingsBrl: z.number(),
    parameters: z.record(z.string(), z.unknown()),
  }),
  requiresExplicitApproval: z.literal(true),
  isDemoData: z.boolean(),
  createdAt: z.string(),
});

export type AIRecommendation = z.infer<typeof AIRecommendationSchema>;

/**
 * Sanitizes untrusted external strings (search terms, ad copy, landing page titles)
 * to mitigate prompt injection before interpolating into AI prompts.
 */
export function sanitizeUntrustedPromptInput(rawInput: string): string {
  return rawInput
    .replace(/ignore\s+(all\s+)?(previous|prior)\s+instructions/gi, "[BLOCKED_INJECTION]")
    .replace(/system\s*prompt/gi, "[BLOCKED_INJECTION]")
    .replace(/execute_?mutation|call_?tool/gi, "[BLOCKED_TOOL_CALL]")
    .slice(0, 1200)
    .trim();
}

export function getDemoAIRecommendations(
  organizationId: string
): AIRecommendation[] {
  const rawList: AIRecommendation[] = [
    {
      id: "rec-demo-01",
      organizationId,
      campaignId: "camp-demo-06",
      campaignName: "[DEMO] Search — Termos Amplos Genéricos (Alerta CPA)",
      clientName: "Imobiliária Alto Padrão PrimeHouse",
      analyzerService: "KEYWORD_ANALYZER",
      title: "Negativar 14 termos informacionais com gasto alto e 0 conversões",
      evidence: [
        {
          metric: "CPA 7 dias",
          observedValue: "R$ 188,00",
          benchmarkOrTarget: "Meta: R$ 65,00 (+189% acima)",
        },
        {
          metric: "Gasto em termos irrelevantes (7d)",
          observedValue: "R$ 412,50",
          benchmarkOrTarget: "0 conversões geradas em 218 cliques",
        },
      ],
      diagnosis:
        "Correspondência ampla em 'Maximizar Cliques' está capturando buscas de aluguel estudantil e plantas gratuitas fora do perfil de alto padrão.",
      justification:
        "A negativação imediata da lista de termos informacionais estanca o desperdício diário estimado em R$ 58,90 sem reduzir impressões de fundo de funil.",
      riskLevel: "LOW",
      proposedAction: {
        actionType: "ADD_NEGATIVE_KEYWORD",
        summary:
          "Adicionar 14 palavras-chave negativas exatas/frase (ex.: 'aluguel barato', 'planta gratis', 'emprego corretor')",
        estimatedMonthlySavingsBrl: 1680,
        parameters: {
          negativeKeywords: [
            "aluguel barato",
            "planta de casas gratis",
            "vaga corretor imoveis",
          ],
          matchType: "PHRASE",
        },
      },
      requiresExplicitApproval: true,
      isDemoData: true,
      createdAt: "2026-11-26T08:15:00-03:00",
    },
    {
      id: "rec-demo-02",
      organizationId,
      campaignId: "camp-demo-02",
      campaignName: "[DEMO] PMax — Primeira Habilitação A/B Local",
      clientName: "Autoescola & CFC Via Rápida",
      analyzerService: "BUDGET_ANALYZER",
      title: "Expansão supervisionada de +15% no orçamento diário (Limitada por Orçamento)",
      evidence: [
        {
          metric: "Parcela de Impressões Perdidas (Orçamento)",
          observedValue: "34,2%",
          benchmarkOrTarget: "Ideal < 10%",
        },
        {
          metric: "CPA 7 dias vs Meta",
          observedValue: "R$ 27,50",
          benchmarkOrTarget: "Meta: R$ 35,00 (-21,4% abaixo da meta)",
        },
      ],
      diagnosis:
        "A campanha esgota o orçamento diário de R$ 150,00 por volta das 15h30, perdendo o horário de pico noturno com ROAS consistente de 5,8x.",
      justification:
        "Incremento conservador de +15% (de R$ 150 para R$ 172,50/dia) respeita o teto de segurança de 20% do Policy Engine e projeta +5 leads/semana.",
      riskLevel: "MEDIUM",
      proposedAction: {
        actionType: "ADJUST_DAILY_BUDGET",
        summary: "Ajustar orçamento diário de R$ 150,00 para R$ 172,50 (+15%)",
        estimatedMonthlySavingsBrl: 950,
        parameters: {
          currentDailyBudgetBrl: 150,
          proposedDailyBudgetBrl: 172.5,
          changePct: 15,
        },
      },
      requiresExplicitApproval: true,
      isDemoData: true,
      createdAt: "2026-11-26T08:10:00-03:00",
    },
    {
      id: "rec-demo-03",
      organizationId,
      campaignId: "camp-demo-03",
      campaignName: "[DEMO] Search — Abertura de Empresa & Migração MEI",
      clientName: "Escritório Contábil FiscalTech B2B",
      analyzerService: "CONVERSION_ANALYZER",
      title: "Queda na taxa de conversão mobile após alteração no formulário LP",
      evidence: [
        {
          metric: "Taxa de Conversão Mobile",
          observedValue: "2,1%",
          benchmarkOrTarget: "Histórico 30d: 5,8%",
        },
        {
          metric: "CPA 7 dias",
          observedValue: "R$ 86,42",
          benchmarkOrTarget: "Meta: R$ 48,00",
        },
      ],
      diagnosis:
        "Cliques permanecem qualificados (CTR 3,15%), porém o evento Enhanced Conversion do WhatsApp deixou de disparar em Safari iOS nos últimos 3 dias.",
      justification:
        "Reduzir temporariamente o Target CPA evita inflação de CPC enquanto o rastreamento da tag GTM da landing page é corrigido.",
      riskLevel: "HIGH",
      proposedAction: {
        actionType: "AUDIT_CONVERSION_TAG",
        summary:
          "Diagnosticar disparo da tag GTM no Safari iOS e manter campanha em observação supervisionada",
        estimatedMonthlySavingsBrl: 1120,
        parameters: {
          tagContainerId: "GTM-DEMO991",
          affectedDevice: "MOBILE_IOS",
        },
      },
      requiresExplicitApproval: true,
      isDemoData: true,
      createdAt: "2026-11-26T07:55:00-03:00",
    },
  ];

  return rawList.map((item) => AIRecommendationSchema.parse(item));
}
