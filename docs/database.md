# Arquitetura de Banco de Dados — Neon PostgreSQL + Drizzle ORM

## 1. Visão Geral

O **Konnexy Ads** utiliza **Neon PostgreSQL** como banco de dados oficial e **Drizzle ORM** para modelagem tipada e migrations versionadas (`drizzle/migrations`).

### Princípios de Modelagem
1. **Multi-Tenancy Nativo**: Todas as tabelas de domínio de cliente e operação possuem `organization_id` (`UUID NOT NULL`) referenciando `organizations.id` com `ON DELETE RESTRICT` ou `CASCADE` controlado.
2. **Precisão Financeira**: Valores monetários são armazenados em **micros** ou **centavos inteiros** (`bigint` / `numeric(14, 2)`) para evitar erros de ponto flutuante IEEE 754.
3. **Auditoria e Rastreabilidade**: Todas as tabelas possuem `created_at` e `updated_at` em UTC (`timestamptz`), e a tabela `audit_logs` registra o estado anterior (`previous_state`), novo estado (`new_state`), ator e `idempotency_key`.
4. **Proibição de Migrations Destrutivas Automáticas**: `drizzle-kit` é utilizado para gerar arquivos SQL revisáveis (`pnpm db:generate`). Nenhuma coluna ou tabela é removida automaticamente sem revisão humana.

---

## 2. Os 22 Domínios Implementados

| # | Domínio | Tabela PostgreSQL | Chave de Isolamento | Descrição |
| :- | :--- | :--- | :--- | :--- |
| 1 | **Organizations** | `organizations` | `id` (Root Tenant) | Agências ou negócios locais, configurações de modo (`READ_ONLY`, `SUPERVISED`), flag de Kill Switch (`emergency_stop`). |
| 2 | **Users** | `users` | Global + Membership | Usuários autenticados via Auth.js. |
| 3 | **Memberships** | `memberships` | `organization_id` | Vínculo N:N entre usuários e organizações com papel RBAC (`OWNER`, `ADMIN`, `TRAFFIC_MANAGER`, `ANALYST`, `CLIENT_VIEWER`). |
| 4 | **Clients** | `clients` | `organization_id` | Clientes atendidos pela organização/agência, nicho, limites mensais de verba. |
| 5 | **Integrations** | `integrations` | `organization_id` | Conexões OAuth com provedores (`GOOGLE_ADS`, `META_ADS`, `MICROSOFT_ADS`, `MOCK_ADS`) e tokens criptografados (AES-256-GCM). |
| 6 | **Ad Accounts** | `ad_accounts` | `organization_id` | Contas de anúncio vinculadas a um cliente e integração (moeda, fuso horário, status). |
| 7 | **Campaigns** | `campaigns` | `organization_id` | Campanhas sincronizadas (Search, Performance Max, Advantage+, etc.), status, objetivo e estratégia de lance. |
| 8 | **Ad Groups** | `ad_groups` | `organization_id` | Grupos/conjuntos de anúncios pertencentes a uma campanha. |
| 9 | **Ads** | `ads` | `organization_id` | Criativos e anúncios individuais, títulos, descrições, URLs finais e status de política. |
| 10 | **Keywords** | `keywords` | `organization_id` | Palavras-chave (Exact, Phrase, Broad), lance, Quality Score e status. |
| 11 | **Search Terms** | `search_terms` | `organization_id` | Termos reais pesquisados pelos usuários para identificação de negativação ou oportunidade. |
| 12 | **Daily Metrics** | `daily_metrics` | `organization_id` | Série temporal diária de impressões, cliques, custo, conversões, valor de conversão, CTR, CPC, CPA e ROAS. |
| 13 | **Conversions** | `conversions` | `organization_id` | Ações de conversão rastreadas, janela de atribuição e status de saúde da tag/pixel. |
| 14 | **Budgets** | `budgets` | `organization_id` | Orçamentos diários e mensais, pacing, limites de segurança e alertas de estouro. |
| 15 | **Recommendations** | `recommendations` | `organization_id` | Recomendações estruturadas geradas pelos 9 serviços de IA com evidências, diagnóstico, risco e ação proposta. |
| 16 | **Automation Rules** | `automation_rules` | `organization_id` | Regras configuradas com condições compostas, janela temporal, volume mínimo de dados, limite financeiro e cooldown. |
| 17 | **Automation Runs** | `automation_runs` | `organization_id` | Histórico de ciclos de avaliação do motor de automação e resultados de simulação. |
| 18 | **Approvals** | `approvals` | `organization_id` | Solicitações de aprovação humana (`PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`) para ações de risco médio/alto. |
| 19 | **Execution Jobs** | `execution_jobs` | `organization_id` | Filas de execução nas APIs externas com `idempotency_key`, tentativas, rollback payload e verificação pós-execução. |
| 20 | **Audit Logs** | `audit_logs` | `organization_id` | Registro imutável de todas as ações humanas, recomendações e execuções automatizadas. |
| 21 | **Reports** | `reports` | `organization_id` | Relatórios executivos gerados por período para clientes e gestores. |
| 22 | **Notifications** | `notifications` | `organization_id` | Alertas críticos de orçamento, anomalias de CPA, aprovações pendentes e acionamento de Kill Switch. |

---

## 3. Políticas de Row-Level Security (RLS) no Neon PostgreSQL

Além da validação obrigatória na camada de aplicação (`assertTenantAccess(ctx, record.organizationId)`), as migrations incluem suporte a políticas RLS baseadas na variável de sessão `app.current_organization_id`:

```sql
-- Exemplo de política aplicável em todas as tabelas com organization_id:
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_campaigns ON campaigns
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);
```
