# Roadmap de Engenharia — Konnexy Ads

## Fase 1 — Foundation 1.0 & 1.1: Security Hardening (Concluída)
- [x] Inicialização Next.js 15.5 App Router, TypeScript Strict, Tailwind CSS v4 e `pnpm`.
- [x] Remediação completa de vulnerabilidades altas e críticas nas dependências (`pnpm audit --audit-level=high` bloqueante no CI).
- [x] Arquitetura de Monólito Modular + Clean Architecture (`src/modules`, `src/domain`, `src/application`, `src/infrastructure`, `src/integrations`, `src/security`, `src/automation`, `src/workflows`).
- [x] Design System SaaS B2B modularizado (`AppSidebar`, `DashboardHeader`, `MobileNavigation`, `DashboardOverview`, `EmergencyStopControl`, `DemoModeBanner`, Command Palette `Ctrl+K`).
- [x] Dashboard Demonstrativo claramente identificado (`MockAdsProvider` — `isDemoData: true`) e Kill Switch de interface explicitamente sinalizado como simulação local.
- [x] Modelagem Drizzle ORM dos 22 domínios multi-tenant com chaves estrangeiras compostas `(organization_id, id)`, políticas PostgreSQL RLS (`USING` + `WITH CHECK`), role `konnexy_app` (`NOBYPASSRLS`) e trigger de imutabilidade/retenção em `audit_logs`.
- [x] Contratos e motores core: 7 Motores de Automação separados, Máquina de Estados explícita (`RecommendationStateMachine`), aprovações estruturadas (`ApprovalRecord`), janelas temporais configuráveis, RBAC com escopo por cliente, Credential Vault AES-256-GCM com AAD e versionamento, SSRF Guard com validação DNS, testes reais em PostgreSQL descartável (`PGlite`) e Playwright E2E em 5 viewports.

---

## Fase 2 & 2.1 — Autenticação Operacional, Multi-Tenancy Persistente & Google Ads Read-Only (Concluída)
- [x] Correções remanescentes da Fase 1: aprovação vinculada ao hash SHA-256 do payload (`actionPayloadHash`), FKs compostas nos relacionamentos opcionais, privilégios PostgreSQL restritos por tabela e sanitização de erros públicos (`src/security/public-errors.ts`).
- [x] Autenticação operacional persistida no PostgreSQL (`/login`, `/onboarding`, logout com revogação em `user_sessions`, rate limiting durável em `auth_rate_limits`, proteção de rotas via `src/middleware.ts` e separação de `/demo`).
- [x] Repositórios Drizzle persistentes (`PersistentDrizzleTenantRepository`) com operações reais para Organizações, Membros, `member_client_access` (`CLIENT_VIEWER`), Clientes (criar/editar/desativar), Integrações, Contas de Anúncios, Campanhas, Métricas Diárias, Sync Runs e Audit Logs.
- [x] `PersistentPostgresGoogleAdsService` (OAuth 2.0 PKCE + `oauth_states` single-use no PostgreSQL, Route Handlers `/api/integrations/google-ads/authorize` e `callback`, Credential Vault AES-256-GCM com AAD e rotação de chaves `v1` → `v2`, revogação persistente e consultas REST Google Ads API `v26`).
- [x] Transporte HTTPS `executePinnedHttpsRequest` com IP pinning real no socket (`node:https` + TLS SNI `servername`) e bloqueio de redirects `3xx`.
- [x] `PersistentPostgresAdsSyncEngine` sincronizando idempotentemente os 9 domínios no PostgreSQL com lock durável em `sync_runs`, recuperação de jobs órfãos e cálculo exato de métricas agregadas sobre os totais do período.

---

## Fase 3 — Inteligência Artificial Supervisionada & Centro de Recomendações
- [ ] Integração dos 9 serviços especializados de IA com Vercel AI SDK v6 sobre métricas reais sincronizadas.
- [ ] Interface dedicada de Revisão e Aprovação de Recomendações persistindo `ApprovalRecord` assinado no PostgreSQL.
- [ ] Geração automatizada de Relatórios Executivos para clientes.

---

## Fase 4 — Execução Supervisionada & Meta Marketing API
- [ ] Habilitação gradual de execução supervisionada no Google Ads mediante aprovação explícita e reconciliação pós-execução.
- [ ] Implementação completa do `MetaAdsProvider`.
