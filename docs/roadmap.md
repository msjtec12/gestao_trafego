# Roadmap de Engenharia — Konnexy Ads

## Fase 1 — Foundation (Concluída nesta Entrega)
- [x] Inicialização Next.js 15 App Router, TypeScript Strict, Tailwind CSS v4 e `pnpm`.
- [x] Arquitetura de Monólito Modular + Clean Architecture (`src/modules`, `src/domain`, `src/application`, `src/infrastructure`, `src/integrations`, `src/security`, `src/automation`, `src/workflows`).
- [x] Design System SaaS B2B (Dark/Light Mode, Sidebar recolhível, Command Palette, Cards analíticos, Gráficos Recharts, Tabelas TanStack Table, PWA Manifest seguro).
- [x] Dashboard Demonstrativo claramente identificado (`MockAdsProvider` — `isDemoData: true`).
- [x] Modelagem Drizzle ORM dos 22 domínios multi-tenant com `organization_id` e migrations SQL iniciais.
- [x] Contratos e motores core: RBAC, Isolamento Multi-Tenant, 7 Motores de Automação, Kill Switch, 9 Schemas Zod de IA, e CI GitHub Actions.

---

## Fase 2 — Autenticação, Multi-Tenancy em Banco Vivo & Google Ads Read-Only
- [ ] Fluxo completo de login e onboarding de organizações e clientes com Auth.js v5 + Neon PostgreSQL.
- [ ] Fluxo OAuth 2.0 real do Google Ads API com armazenamento criptografado no Credential Vault (`AES-256-GCM`).
- [ ] Worker de sincronização inicial (somente leitura) via Vercel Cron para Campanhas, Grupos de Anúncios, Palavras-chave, Termos de Pesquisa e Métricas Diárias.

---

## Fase 3 — Inteligência Artificial Supervisionada & Centro de Recomendações
- [ ] Integração dos 9 serviços especializados de IA com Vercel AI SDK (`generateObject`) sobre métricas reais sincronizadas.
- [ ] Interface dedicada de Revisão e Aprovação de Recomendações com comparação lado a lado (Simulação de Impacto vs. Risco).
- [ ] Geração automatizada de Relatórios Executivos para clientes.

---

## Fase 4 — Execução Supervisionada & Meta Marketing API
- [ ] Habilitação gradual de execução supervisionada no Google Ads (negativação de termos, ajuste de orçamento dentro da trava financeira, pausa de anúncios com CPA crítico) mediante aprovação explícita.
- [ ] Verificação pós-execução automatizada e rollback assistido.
- [ ] Implementação completa do `MetaAdsProvider` (Campanhas, Conjuntos de Anúncios, Criativos e Eventos de Conversão).
