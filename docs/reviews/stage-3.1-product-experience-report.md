# Konnexy Ads — Etapa 3.1: Product Experience & Operational Dashboard

**Branch:** `feat/stage-3.1-operational-product-experience`
**Modo Operacional:** `READ_ONLY` (nenhuma mutação real em plataformas de anúncios habilitada)
**Stack Preservada:** Next.js App Router + TypeScript Strict + Tailwind CSS v4 + Neon PostgreSQL + Drizzle ORM + RLS (`SET LOCAL ROLE konnexy_app`) + Auth.js v5 + 9 Serviços de IA Supervisionada.

---

## 1. Resumo da Entrega

A Etapa 3.1 transforma o Konnexy Ads em uma plataforma comercial operacional para gestores de tráfego pago, removendo termos de engenharia da navegação principal e estruturando:

1. **Navegação Comercial Dedicada (15 rotas + detalhe de cliente + exportação PDF):**
   - Operação: `/` (Visão Geral), `/clientes`, `/clientes/[id]`, `/campanhas`, `/grupos-de-anuncios`, `/anuncios`, `/palavras-chave`, `/termos-de-pesquisa`, `/conversoes`, `/orcamentos`.
   - Inteligência & Otimização: `/ia` (Central de IA), `/recomendacoes`, `/automacoes`, `/relatorios`, `/relatorios/[id]/imprimir`.
   - Plataforma: `/integracoes`, `/configuracoes` (com seção administrativa restrita a `OWNER`/`ADMIN` para diagnósticos de arquitetura, tabelas e trilha de auditoria).
2. **Onboarding Guiado em 9 Etapas:** Checklist persistente derivado do estado real do banco e da disponibilidade de credenciais OAuth externas (`CONCLUIDO`, `PENDENTE`, `BLOQUEADO_CREDENCIAIS`).
3. **Gestão Comercial de Clientes:** Cadastro e edição de dados cadastrais, segmento, site oficial (`website_url`), orçamento mensal, CPA desejado e ROAS desejado (`target_roas`), com páginas individuais (`/clientes/[id]`) reunindo contas vinculadas, histórico de desempenho, recomendações, relatórios e histórico de otimizações (`audit_logs`).
4. **Central de Integrações Honesta:** Cards para Google Ads (`READ_ONLY` priorizado com 6 estados reais) e Meta Ads, Google Analytics 4 e Google Search Console explicitamente marcados como `Em desenvolvimento` com botões desabilitados.
5. **Dashboard Profissional com Filtros & Comparativo:** Filtros por cliente, conta, campanha e período (7/14/30 dias) com métricas reais (Investimento, Impressões, Cliques, CTR, CPC, Conversões, CPA, Taxa de Conversão, ROAS, Consumo de Orçamento e Comparativo com Período Anterior — exibindo `"Sem dados"` / `"Sem base anterior"` quando zerado).
6. **Central de Otimização & IA Comercial:** Os 9 analisadores organizados em 7 pilares compreensíveis para gestores de tráfego (Desempenho, Palavras-chave, Orçamento, Conversões, Estratégia, Landing Pages e Anúncios), com problema, evidências, ação recomendada, risco, status de aprovação e aprovação/rejeição auditada sem previsões inventadas e sem execução direta nas plataformas.
7. **Relatórios Comerciais & Exportação em PDF:** Geração por cliente e período, com resumo executivo, indicadores, gráfico, comparativo, ações realizadas, recomendações e exportação em PDF (`/relatorios/[id]/imprimir`) com identidade visual Konnexy.

---

## 2. Auditoria Operacional Completa (Rotas, Botões, Formulários e Filtros)

| Funcionalidade / Rota / Controle | Classificação | Evidência / Observação |
|---|---|---|
| `/` — Visão Geral, KPIs, Filtros (Cliente/Conta/Campanha/Período) e Comparativo | **Operacional e verificada** | Verificado em `e2e/dashboard.spec.ts` e `e2e/stage3-1-product-experience.spec.ts` + Axe WCAG 0 violações. |
| `/` — Checklist de Onboarding Guiado (9 etapas) | **Operacional e verificada** | Verificado em `stage3-1-product-experience.test.ts` e E2E; diferencia etapas configuradas vs bloqueadas por credenciais. |
| `/clientes` — Carteira Comercial, Busca e Cadastro (`websiteUrl`, `targetRoas`, CPA, Orçamento) | **Operacional e verificada** | Persistência validada sob RLS em `stage3-1-product-experience.test.ts` e E2E. |
| `/clientes/[id]` — Perfil Individual do Cliente (Edição, Contas, Desempenho, Recomendações, Relatórios, Auditoria) | **Operacional e verificada** | Persistência validada em PostgreSQL e navegação E2E. |
| `/campanhas`, `/grupos-de-anuncios`, `/anuncios`, `/palavras-chave`, `/termos-de-pesquisa`, `/conversoes`, `/orcamentos` | **Operacional e verificada** | Todas as 7 rotas renderizam dados reais persistidos com busca/filtro e estados vazios orientativos (verificadas em E2E). |
| `/ia` & `/recomendacoes` — Central de IA, Execução de Análise e Aprovação/Rejeição Auditada | **Operacional e verificada** | Validado com os 9 analisadores + `PolicyEngine` + aprovação assinada em `stage3-supervised-ai-and-reports.test.ts` e E2E. |
| `/automacoes` — Regras de Automação Supervisionada e Histórico de Simulações (`READ_ONLY`) | **Operacional e verificada** | Leitura persistente de `automation_rules` e `automation_runs` em modo `READ_ONLY`. |
| `/relatorios` & `/relatorios/[id]/imprimir` — Relatórios Comerciais e Exportação PDF | **Operacional e verificada** | Geração persistente verificada em E2E; exportação PDF via `window.print()` com layout Konnexy dedicado. |
| `/configuracoes` — Perfil da Organização, Equipe, Trava de Emergência e Diagnóstico Administrativo Restrito (`OWNER`/`ADMIN`) | **Operacional e verificada** | Edição de organização persistida sob RLS + painel restrito validado com Axe WCAG (0 violações). |
| `/integracoes` — Conectar Google Ads OAuth 2.0 (`READ_ONLY`) e Sincronizar Conta Real | **Bloqueada por credenciais** | Fluxo OAuth PKCE e motor incremental implementados e testados; depende de `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` e `GOOGLE_ADS_DEVELOPER_TOKEN` válidos no ambiente. |
| `/integracoes` — Meta Ads, Google Analytics 4 e Google Search Console | **Não implementada** | Exibidos honestamente com badge `Em desenvolvimento` e botões desabilitados (nenhuma simulação enganosa). |
| `/demo` — Ambiente Demonstrativo Isolado (`MockAdsProvider`) | **Demonstrativa** | Isolado em `/demo` com banner explícito `AMBIENTE DEMONSTRATIVO` e `isDemoData: true`, sem jamais vazar para `/`. |
| Execução real de mutações em campanhas nas plataformas de anúncios | **Não implementada** | Proibida por governança (`READ_ONLY` preservado em toda a plataforma). |

---

## 3. Evidências de Testes Executados

| Suite | Comando | Resultado |
|---|---|---|
| ESLint Strict | `pnpm lint` (`--max-warnings 0`) | **PASS** (0 erros, 0 warnings) |
| TypeScript Strict | `pnpm typecheck` (`tsc --noEmit`) | **PASS** (0 erros) |
| Unit & PostgreSQL RLS Integration | `pnpm test` | **PASS** — **8 suítes, 60 testes aprovados** (2 condicionais de Neon live pulados por ausência de `NEON_STAGING_DATABASE_URL` local) |
| Production Build | `pnpm build` | **PASS** — Todas as 15 rotas comerciais + `/clientes/[id]` + `/relatorios/[id]/imprimir` compiladas |
| Playwright E2E + Axe WCAG 2.0 A/AA | `pnpm test:e2e` | **PASS** — **9/9 cenários aprovados** (0 violações críticas/sérias de acessibilidade) |
