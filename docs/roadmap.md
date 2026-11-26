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

## Fase 2 — Autenticação Real, Multi-Tenancy Persistente & Google Ads Read-Only (Concluída)
- [x] Correções remanescentes da Fase 1: aprovação vinculada ao hash SHA-256 do payload (`actionPayloadHash`), FKs compostas nos relacionamentos opcionais, privilégios PostgreSQL restritos por tabela e sanitização de erros públicos.
- [x] Autenticação com Auth.js v5 (`5.0.0-beta.32`), rate limiting contra abuso, validação autoritativa de sessão/role no servidor e onboarding seguro da primeira organização em `READ_ONLY`.
- [x] Repositórios Drizzle persistentes (`PersistentDrizzleTenantRepository`) e tabela `member_client_access` garantindo isolamento para `CLIENT_VIEWER`.
- [x] Central Multi-Tenant responsiva para gestão de Organizações, Membros, Clientes, Contas MCC, Integrações e Configurações.
- [x] `GoogleAdsReadOnlyIntegrationService` (OAuth 2.0 PKCE + HMAC state, Credential Vault AES-256-GCM com AAD obrigatório, suporte a MCC, seleção de contas, revogação e GAQL estritamente `SELECT`).
- [x] `IncrementalAdsSyncEngine` para os 9 domínios com lock de concorrência, checkpoints e conversão exata de `cost_micros`.
- [x] Dashboard Operacional com seletores de Organização, Cliente, Conta e Período, diferenciação entre zero/`Sem dados`/`N/D` e Logo Oficial Konnexy Ads.

---

## Fase 3 — Inteligência Artificial Supervisionada & Centro de Recomendações
- [ ] Integração dos 9 serviços especializados de IA com Vercel AI SDK v6 sobre métricas reais sincronizadas.
- [ ] Interface dedicada de Revisão e Aprovação de Recomendações persistindo `ApprovalRecord` assinado no PostgreSQL.
- [ ] Geração automatizada de Relatórios Executivos para clientes.

---

## Fase 4 — Execução Supervisionada & Meta Marketing API
- [ ] Habilitação gradual de execução supervisionada no Google Ads mediante aprovação explícita e reconciliação pós-execução.
- [ ] Implementação completa do `MetaAdsProvider`.
