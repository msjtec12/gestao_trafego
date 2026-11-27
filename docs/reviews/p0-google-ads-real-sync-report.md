# Konnexy Ads — Relatório Técnico P0: Real Google Ads Data Sync & Integridade de Dados

**Branch:** `fix/google-ads-data-integrity`
**Pull Request:** https://github.com/msjtec12/gestao_trafego/pull/9
**Modo Operacional:** `READ_ONLY` (nenhuma mutação nas campanhas)

---

## 1. Resumo da Correção Definitiva

Sobre a contenção emergencial (`7d6c7c2`) da branch `fix/google-ads-data-integrity`, foi implementada a arquitetura definitiva de sincronização real com a **Google Ads API v26 (READ_ONLY)** e blindagem de integridade de dados:

| Pilar | Arquivos | O que foi implementado |
|---|---|---|
| **1. Adaptador Oficial Live (`GoogleAdsLiveSyncAdapter`)** | `src/integrations/google-ads/google-ads-live-sync-adapter.ts`, `src/integrations/google-ads/google-ads-oauth-and-readonly.ts` | Utiliza exclusivamente `listAccessibleCustomersViaRest()`, `executeReadOnlyGaqlSearchViaRest()` (com override `login-customer-id` para subcontas MCC, paginação `nextPageToken`, retry exponencial e SSRF pinning) e `refreshAccessTokenInPostgres()` automático. Zero `MockAdsProvider`, zero fixtures hardcoded (`CAMP-*`, `AG-*`, `AD-*`, `4028819001`). |
| **2. Descoberta Real & Vínculo Explícito Conta ↔ Cliente** | `src/app/actions/operational-actions.ts`, `src/components/dashboard/tenant-management-hub.tsx` | `discoverGoogleAdsAccountsServerAction` descobre contas individuais e MCC reais (`customer_client` GAQL, trazendo moeda e fuso horário oficiais); `bindGoogleAdsAccountToClientServerAction` exige seleção explícita do cliente (`clientId`) e `customer_id` numérico de 10 dígitos — **nunca associa automaticamente a `clients[0]`**. |
| **3. Importação GAQL Completa (9 Domínios) & Falha Fechada** | `src/integrations/google-ads/google-ads-live-sync-adapter.ts`, `src/app/actions/operational-actions.ts` | Consultas GAQL oficiais para `customer`, `campaign`, `ad_group`, `ad_group_ad`, `ad_group_criterion`, `search_term_view`, `conversion_action`, `daily_metrics` (`segments.date BETWEEN`) e `budgets`. Qualquer falha parcial aborta a sincronização e impede marcação como `COMPLETED`. |
| **4. Precisão Monetária & Métricas** | `computeExactGoogleAdsMetrics()` em `src/integrations/google-ads/google-ads-live-sync-adapter.ts` | Normalização exata de `cost_micros / 1_000_000`, `CPC = spend / clicks`, `CTR = clicks / impressions * 100`, `CPA = spend / conversions`, `ROAS = conversionValue / spend`, preservação de conversões fracionárias e distinção rigorosa entre `0` e `null` (indisponível). |
| **5. Reconciliação & Quarentena Não Destrutiva** | `src/infrastructure/db/reconciliation/data-integrity-reconciler.ts`, `docs/reviews/p0-google-ads-quarantine-and-recovery-plan.sql` | Auditoria somente leitura que identifica campanhas sintéticas (`CAMP-*` / `is_demo_data`), contas fictícias (`4028819001`), métricas contaminadas, recomendações, relatórios e `sync_runs` (`ckpt-pg-*`). Runbook SQL com backup em tabelas `quarantine_p0_*` sem excluir dados automaticamente e sem alterar `users`, `organizations`, `clients` ou credenciais OAuth. |
| **6. Interface & Proveniência** | `src/components/dashboard/campaigns-table.tsx`, `src/components/dashboard/performance-chart.tsx`, `src/components/dashboard/dashboard-shell.tsx`, `src/components/dashboard/dashboard-overview.tsx` | Removidos rótulos fixos `"Campanha / Cliente (Demo)"`, `"MOCK PROVIDER • SOMENTE LEITURA"` e `"DADOS DEMO"` em ambientes operacionais. Exibe fonte oficial (`GOOGLE ADS API v26 • SOMENTE LEITURA`), ID real da campanha, período, última sincronização verificada, alerta de dados desatualizados (>24h) e banner de contaminação. |
| **7. Bloqueio de IA & Relatórios** | `assertVerifiedOperationalDataForAI()` em `src/infrastructure/db/reconciliation/data-integrity-reconciler.ts` e `src/app/actions/operational-actions.ts` | Bloqueia análise de IA, aprovação de recomendações e geração de relatórios quando houver registros sintéticos/contaminados, sincronização incompleta ou conta não autorizada. |

---

## 2. Evidências de Testes Automatizados

| Verificação | Comando | Resultado |
|---|---|---|
| ESLint Strict | `pnpm lint` (`--max-warnings 0`) | **PASS** (0 erros, 0 warnings) |
| TypeScript Strict | `pnpm typecheck` (`tsc --noEmit`) | **PASS** (0 erros) |
| Unit, RLS & Anti-Contaminação | `pnpm test` | **PASS** — **9 suítes, 63 testes aprovados** (incluindo `p0-google-ads-real-sync-and-integrity.test.ts` validando ausência de fixtures sintéticas no código, precisão matemática da fórmula com os valores de referência `3.020 impr / 239 cliques / R$ 68,85 -> CPC R$ 0,29 / CTR 7,91%`, descoberta MCC, 8 queries GAQL, falha fechada em erro parcial e bloqueio de IA sob contaminação) |
| Build de Produção | `pnpm build` | **PASS** |
| Playwright E2E + Axe WCAG | `pnpm test:e2e` | **PASS** — **8/8 cenários aprovados** |

---

## 3. Status do Teste de Aceite Obrigatório com a Google Ads API Real

> **Status Atual: `PENDING_LIVE_API_ACCEPTANCE` (Aguardando execução em ambiente com credenciais OAuth reais e Neon de produção/staging)**
>
> Por segurança e governança, este ambiente local não possui acesso às credenciais OAuth de produção nem ao banco Neon de produção. Portanto, **esta correção NÃO é declarada concluída em produção até a execução do teste de aceite real abaixo**:

1. **Executar Etapa A (somente leitura)** de `docs/reviews/p0-google-ads-quarantine-and-recovery-plan.sql` no Neon para confirmar os registros contaminados e, após aprovação explícita do proprietário, executar a **Etapa B (backup em `quarantine_p0_*` + limpeza controlada)**.
2. No ambiente autenticado com a conta Google Ads real conectada:
   - Clicar em **"Descobrir Contas Reais"** na aba Integrações.
   - Vincular explicitamente o `customer_id` oficial da conta de **PESQ - Corporativo SP - 2026** ao cliente correto.
   - Executar a sincronização real para o período **2026-11-20 a 2026-11-26**.
3. **Conferência de Aceite (Google Ads Oficial vs. Neon PostgreSQL / UI):**
   - Campanha: `PESQ - Corporativo SP - 2026` (ID numérico oficial)
   - Impressões: `3.020`
   - Cliques: `239`
   - Investimento: `R$ 68,85`
   - CPC médio: `R$ 0,29`
   - CTR aproximado: `7,91%`
