"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { OperationalEntityTable } from "./operational-entity-table";
import type {
  AdGroupRowViewModel,
  AdRowViewModel,
  AutomationRuleRowViewModel,
  AutomationRunRowViewModel,
  BudgetRowViewModel,
  CommercialClientViewModel,
  ConversionRowViewModel,
  KeywordRowViewModel,
  SearchTermRowViewModel,
} from "@/application/use-cases/operational-workspace-loader";

function formatBrl(v: number | null): string {
  if (v === null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function AdGroupsView({
  rows,
}: {
  readonly rows: readonly AdGroupRowViewModel[];
}) {
  return (
    <OperationalEntityTable
      title="Grupos de Anúncios"
      description="Estrutura de segmentação e lances padrão sincronizada por campanha."
      rows={rows}
      searchPlaceholder="Buscar grupo, campanha ou cliente..."
      getSearchableText={(r) => `${r.name} ${r.campaignName} ${r.clientName}`}
      emptyTitle="Nenhum grupo de anúncios sincronizado"
      emptyDescription="Conecte o Google Ads e execute uma sincronização para listar seus grupos de anúncios reais."
      columns={[
        {
          key: "name",
          header: "Grupo de Anúncios",
          render: (r) => <span className="font-semibold">{r.name}</span>,
        },
        { key: "campaign", header: "Campanha", render: (r) => r.campaignName },
        { key: "client", header: "Cliente", render: (r) => r.clientName },
        {
          key: "cpc",
          header: "CPC Máx. Padrão",
          render: (r) => formatBrl(r.defaultCpcBidBrl),
        },
        {
          key: "status",
          header: "Status",
          render: (r) => (
            <Badge variant={r.status === "ENABLED" ? "success" : "secondary"}>
              {r.status}
            </Badge>
          ),
        },
      ]}
    />
  );
}

export function AdsView({ rows }: { readonly rows: readonly AdRowViewModel[] }) {
  return (
    <OperationalEntityTable
      title="Anúncios"
      description="Títulos, descrições, URLs finais e aprovação de políticas dos anúncios ativos."
      rows={rows}
      searchPlaceholder="Buscar título, URL ou campanha..."
      getSearchableText={(r) =>
        `${r.headlines.join(" ")} ${r.finalUrl} ${r.campaignName} ${r.adGroupName}`
      }
      emptyTitle="Nenhum anúncio sincronizado"
      emptyDescription="Sincronize sua conta Google Ads para auditar criativos, títulos e páginas de destino."
      columns={[
        {
          key: "headline",
          header: "Anúncio / Títulos",
          render: (r) => (
            <div className="space-y-0.5 max-w-xs">
              <p className="font-semibold truncate">
                {r.headlines[0] ?? "Anúncio sem título"}
              </p>
              <p className="text-[11px] text-slate-500 truncate">
                {r.finalUrl}
              </p>
            </div>
          ),
        },
        { key: "campaign", header: "Campanha", render: (r) => r.campaignName },
        { key: "type", header: "Tipo", render: (r) => r.adType },
        {
          key: "policy",
          header: "Política",
          render: (r) => (
            <Badge
              variant={
                r.policyApprovalStatus === "APPROVED" ? "success" : "warning"
              }
            >
              {r.policyApprovalStatus}
            </Badge>
          ),
        },
        {
          key: "status",
          header: "Status",
          render: (r) => <Badge variant="secondary">{r.status}</Badge>,
        },
      ]}
    />
  );
}

export function KeywordsView({
  rows,
}: {
  readonly rows: readonly KeywordRowViewModel[];
}) {
  return (
    <OperationalEntityTable
      title="Palavras-chave"
      description="Correspondências, índice de qualidade, lances e palavras negativas."
      rows={rows}
      searchPlaceholder="Buscar palavra-chave ou campanha..."
      getSearchableText={(r) =>
        `${r.text} ${r.matchType} ${r.campaignName} ${r.adGroupName}`
      }
      emptyTitle="Nenhuma palavra-chave sincronizada"
      emptyDescription="Sincronize sua conta Google Ads para acompanhar índice de qualidade e correspondências."
      columns={[
        {
          key: "text",
          header: "Palavra-chave",
          render: (r) => (
            <span className="font-semibold">
              {r.isNegative ? `[NEGATIVA] ${r.text}` : r.text}
            </span>
          ),
        },
        { key: "match", header: "Correspondência", render: (r) => r.matchType },
        { key: "campaign", header: "Campanha", render: (r) => r.campaignName },
        {
          key: "qs",
          header: "Índice de Qualidade",
          render: (r) =>
            r.qualityScore !== null ? `${r.qualityScore}/10` : "Sem dados",
        },
        {
          key: "cpc",
          header: "Lance CPC",
          render: (r) => formatBrl(r.cpcBidBrl),
        },
      ]}
    />
  );
}

export function SearchTermsView({
  rows,
}: {
  readonly rows: readonly SearchTermRowViewModel[];
}) {
  return (
    <OperationalEntityTable
      title="Termos de Pesquisa"
      description="Consultas reais acionadas pelos seus anúncios para identificar desperdício de verba e oportunidades."
      rows={rows}
      searchPlaceholder="Buscar termo de pesquisa ou campanha..."
      getSearchableText={(r) => `${r.searchTerm} ${r.campaignName}`}
      emptyTitle="Nenhum termo de pesquisa sincronizado"
      emptyDescription="Sincronize o Google Ads para inspecionar quais buscas estão consumindo orçamento."
      columns={[
        {
          key: "term",
          header: "Termo Pesquisado",
          render: (r) => <span className="font-semibold">{r.searchTerm}</span>,
        },
        { key: "campaign", header: "Campanha", render: (r) => r.campaignName },
        {
          key: "clicks",
          header: "Cliques / Impr.",
          render: (r) => `${r.clicks} / ${r.impressions}`,
        },
        {
          key: "spend",
          header: "Investimento",
          render: (r) => formatBrl(r.spendBrl),
        },
        {
          key: "conv",
          header: "Conversões",
          render: (r) => r.conversions.toLocaleString("pt-BR"),
        },
        { key: "date", header: "Data", render: (r) => r.observedDate },
      ]}
    />
  );
}

export function ConversionsView({
  rows,
}: {
  readonly rows: readonly ConversionRowViewModel[];
}) {
  return (
    <OperationalEntityTable
      title="Conversões & Metas de Rastreamento"
      description="Acompanhe ações de conversão primárias, modelo de atribuição e saúde do rastreamento."
      rows={rows}
      searchPlaceholder="Buscar conversão ou conta..."
      getSearchableText={(r) => `${r.name} ${r.category} ${r.adAccountName}`}
      emptyTitle="Nenhuma ação de conversão sincronizada"
      emptyDescription="Conecte e sincronize o Google Ads para monitorar a saúde das tags e eventos de conversão."
      columns={[
        {
          key: "name",
          header: "Ação de Conversão",
          render: (r) => (
            <div>
              <p className="font-semibold">{r.name}</p>
              <p className="text-[11px] text-slate-500">{r.adAccountName}</p>
            </div>
          ),
        },
        { key: "category", header: "Categoria", render: (r) => r.category },
        {
          key: "model",
          header: "Atribuição",
          render: (r) => `${r.attributionModel} (${r.lookbackWindowDays}d)`,
        },
        {
          key: "primary",
          header: "Meta Primária",
          render: (r) => (
            <Badge variant={r.isPrimaryGoal ? "success" : "secondary"}>
              {r.isPrimaryGoal ? "Primária" : "Secundária"}
            </Badge>
          ),
        },
        {
          key: "status",
          header: "Rastreamento",
          render: (r) => (
            <Badge
              variant={r.trackingStatus === "ACTIVE" ? "success" : "warning"}
            >
              {r.trackingStatus}
            </Badge>
          ),
        },
      ]}
    />
  );
}

export function BudgetsView({
  budgets,
  clients,
}: {
  readonly budgets: readonly BudgetRowViewModel[];
  readonly clients: readonly CommercialClientViewModel[];
}) {
  return (
    <div className="space-y-6">
      <OperationalEntityTable
        title="Metas Mensais por Cliente"
        description="Orçamento mensal planejado, CPA desejado e ROAS alvo configurados por cliente."
        rows={clients}
        searchPlaceholder="Buscar cliente ou segmento..."
        getSearchableText={(c) => `${c.name} ${c.industry}`}
        emptyTitle="Nenhum cliente cadastrado"
        emptyDescription="Cadastre um cliente para definir orçamento mensal e metas comerciais."
        emptyActionHref="/clientes"
        emptyActionLabel="Cadastrar primeiro cliente"
        columns={[
          {
            key: "client",
            header: "Cliente",
            render: (c) => (
              <Link
                href={`/clientes/${c.id}`}
                className="font-semibold text-cyan-700 dark:text-cyan-400 hover:underline"
              >
                {c.name}
              </Link>
            ),
          },
          { key: "industry", header: "Segmento", render: (c) => c.industry },
          {
            key: "budget",
            header: "Teto Mensal",
            render: (c) => formatBrl(c.monthlyBudgetCapBrl),
          },
          {
            key: "cpa",
            header: "CPA Desejado",
            render: (c) => formatBrl(c.targetCpaBrl),
          },
          {
            key: "roas",
            header: "ROAS Desejado",
            render: (c) =>
              c.targetRoas !== null ? `${c.targetRoas}x` : "Não aplicável",
          },
        ]}
      />

      <OperationalEntityTable
        title="Acompanhamento de Pacing Mensal"
        description="Consumo real registrado por período mensal frente ao orçamento planejado."
        rows={budgets}
        searchPlaceholder="Buscar cliente ou mês..."
        getSearchableText={(b) => `${b.clientName} ${b.periodMonth}`}
        emptyTitle="Nenhum histórico de pacing mensal ainda"
        emptyDescription="Os registros de consumo mensal são preenchidos automaticamente conforme as sincronizações do Google Ads avançam."
        columns={[
          {
            key: "client",
            header: "Cliente",
            render: (b) => <span className="font-semibold">{b.clientName}</span>,
          },
          { key: "month", header: "Mês", render: (b) => b.periodMonth },
          {
            key: "planned",
            header: "Planejado",
            render: (b) => formatBrl(b.plannedBudgetBrl),
          },
          {
            key: "spent",
            header: "Consumido",
            render: (b) => formatBrl(b.spentBudgetBrl),
          },
          {
            key: "pct",
            header: "Consumo",
            render: (b) => `${b.consumptionPct}%`,
          },
          {
            key: "status",
            header: "Situação",
            render: (b) => (
              <Badge
                variant={
                  b.status === "EXCEDIDO"
                    ? "destructive"
                    : b.status === "ATENCAO"
                      ? "warning"
                      : "success"
                }
              >
                {b.status}
              </Badge>
            ),
          },
        ]}
      />
    </div>
  );
}

export function AutomationsView({
  rules,
  runs,
}: {
  readonly rules: readonly AutomationRuleRowViewModel[];
  readonly runs: readonly AutomationRunRowViewModel[];
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 text-xs flex items-center gap-2.5">
        <ShieldCheck className="h-4 w-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
        <span>
          <strong>Proteção READ_ONLY Ativa:</strong> Todas as regras operam sob
          validação humana e simulação. Nenhuma alteração real é aplicada nas
          plataformas de anúncios sem aprovação explícita e liberação de modo.
        </span>
      </div>

      <OperationalEntityTable
        title="Regras de Automação Supervisionada"
        description="Políticas de proteção de verba, alertas de CPA e pausas supervisionadas."
        rows={rules}
        searchPlaceholder="Buscar regra..."
        getSearchableText={(r) => `${r.name} ${r.description}`}
        emptyTitle="Nenhuma regra de automação configurada"
        emptyDescription="Nesta etapa (READ_ONLY), as otimizações são geradas como recomendações na Central de IA para aprovação humana."
        emptyActionHref="/ia"
        emptyActionLabel="Abrir Central de Inteligência Artificial"
        columns={[
          {
            key: "name",
            header: "Regra",
            render: (r) => (
              <div>
                <p className="font-semibold">{r.name}</p>
                <p className="text-[11px] text-slate-500">{r.description}</p>
              </div>
            ),
          },
          { key: "mode", header: "Modo", render: (r) => r.executionMode },
          { key: "risk", header: "Risco", render: (r) => r.riskLevel },
          {
            key: "cooldown",
            header: "Cooldown",
            render: (r) => `${r.cooldownMinutes} min`,
          },
          {
            key: "enabled",
            header: "Status",
            render: (r) => (
              <Badge variant={r.isEnabled ? "success" : "secondary"}>
                {r.isEnabled ? "Ativa" : "Pausada"}
              </Badge>
            ),
          },
        ]}
      />

      <OperationalEntityTable
        title="Execuções Recentes"
        description="Histórico imutável de simulações e avaliações das regras."
        rows={runs}
        searchPlaceholder="Buscar execução..."
        getSearchableText={(r) => `${r.ruleName} ${r.status}`}
        emptyTitle="Nenhuma execução registrada"
        emptyDescription="Quando regras forem avaliadas em simulação, o histórico completo aparecerá aqui."
        emptyActionHref="/recomendacoes"
        emptyActionLabel="Ver Recomendações"
        columns={[
          {
            key: "rule",
            header: "Regra",
            render: (r) => <span className="font-semibold">{r.ruleName}</span>,
          },
          {
            key: "sim",
            header: "Tipo",
            render: (r) => (
              <Badge variant="secondary">
                {r.isSimulation ? "Simulação" : "Execução"}
              </Badge>
            ),
          },
          { key: "status", header: "Status", render: (r) => r.status },
          {
            key: "date",
            header: "Executado em",
            render: (r) => new Date(r.executedAtIso).toLocaleString("pt-BR"),
          },
        ]}
      />
    </div>
  );
}
