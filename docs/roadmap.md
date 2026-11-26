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

## Fase 2 — Autenticação Real, Persistência Neon em Nuvem & Google Ads Read-Only
- [ ] Fluxo completo de login, sessão e onboarding de organizações e clientes com Auth.js v5 (`5.0.0-beta.32`) + Neon PostgreSQL.
- [ ] Persistência em banco vivo para o Kill Switch global/organizacional, `IdempotencyStore` e `CircuitBreakerStore`.
- [ ] Fluxo OAuth 2.0 real do Google Ads API com armazenamento criptografado no Credential Vault (`AES-256-GCM` + AAD).
- [ ] Worker de sincronização inicial (somente leitura) via Vercel Cron para Campanhas, Grupos de Anúncios, Palavras-chave, Termos de Pesquisa e Métricas Diárias.

---

## Fase 3 — Inteligência Artificial Supervisionada & Centro de Recomendações
- [ ] Integração dos 9 serviços especializados de IA com Vercel AI SDK v6 sobre métricas reais sincronizadas.
- [ ] Interface dedicada de Revisão e Aprovação de Recomendações persistindo `ApprovalRecord` assinado no PostgreSQL.
- [ ] Geração automatizada de Relatórios Executivos para clientes.

---

## Fase 4 — Execução Supervisionada & Meta Marketing API
- [ ] Habilitação gradual de execução supervisionada no Google Ads mediante aprovação explícita e reconciliação pós-execução.
- [ ] Implementação completa do `MetaAdsProvider`.
