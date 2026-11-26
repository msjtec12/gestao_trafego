# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.1.0] - 2026-11-26 — Foundation Release

### Adicionado
- **Arquitetura & Setup**: Inicialização do monólito modular com Next.js 15 App Router, TypeScript Strict, Tailwind CSS v4 e `pnpm`.
- **Design System B2B**: Tema escuro/claro (Deep Navy + Cyan Highlight), Sidebar recolhível, Header com indicador de modo de operação (`SOMENTE LEITURA`), Botão de Emergência (Kill Switch) e Command Palette (`Ctrl+K` / `Cmd+K`).
- **Dashboard Demonstrativo**:
  - Banner explícito de identificação de dados simulados (`MockAdsProvider` — `isDemoData: true`).
  - Cards analíticos de performance (Investimento, Conversões, CPA, ROAS, CTR, Saúde da Conta).
  - Gráfico interativo de tendência temporal (Investimento vs. Conversões e CPA) com Recharts.
  - Tabela avançada de campanhas com TanStack Table (busca textual, filtro por canal e status, ordenação multi-coluna e paginação).
  - Painel de Recomendações de IA supervisionadas com evidências, diagnóstico, nível de risco e fluxo de aprovação humana.
  - Painel do Motor de Automações com status dos 7 motores e trilha de auditoria recente.
- **Banco de Dados (Drizzle ORM + Neon PostgreSQL)**:
  - Schema completo abrangendo os 22 domínios multi-tenant (`organizations`, `users`, `memberships`, `clients`, `integrations`, `ad_accounts`, `campaigns`, `ad_groups`, `ads`, `keywords`, `search_terms`, `daily_metrics`, `conversions`, `budgets`, `recommendations`, `automation_rules`, `automation_runs`, `approvals`, `execution_jobs`, `audit_logs`, `reports`, `notifications`).
  - Migration SQL inicial e políticas de isolamento por `organization_id`.
- **Motores Core & Segurança**:
  - RBAC (`OWNER`, `ADMIN`, `TRAFFIC_MANAGER`, `ANALYST`, `CLIENT_VIEWER`) e guardas de isolamento multi-tenant.
  - Motor de Automação com validação de janela temporal, dados mínimos, limite financeiro, cooldown, idempotência, circuit breaker e Kill Switch.
  - Interface `AdvertisingProvider` com implementação de `MockAdsProvider` e contrato de `GoogleAdsProvider`.
  - Schemas Zod estritos para os 9 serviços especializados de IA e bloqueio de políticas de produtos restritos.
- **Qualidade & DevSecOps**:
  - Testes automatizados no Vitest cobrindo isolamento entre organizações, permissões RBAC, regras automatizadas, idempotência e falhas de integração.
  - Configuração do Playwright e pipeline `.github/workflows/ci.yml`.
  - Documentação técnica completa em `docs/` e ADRs em `docs/adr/`.
