# Konnexy Ads

> **Plataforma SaaS Multi-Tenant para Gestão Centralizada, Inteligência Artificial Auditável e Automação Supervisionada de Tráfego Pago.**

[![CI Pipeline](https://github.com/msjtec12/gestao_trafego/actions/workflows/ci.yml/badge.svg)](https://github.com/msjtec12/gestao_trafego/actions)
![TypeScript Strict](https://img.shields.io/badge/TypeScript-Strict-007ACC?logo=typescript&logoColor=white)
![Next.js 15.5](https://img.shields.io/badge/Next.js-15.5_App_Router-000000?logo=next.js)
![Neon PostgreSQL](https://img.shields.io/badge/Database-Neon_PostgreSQL_RLS-00E599?logo=postgresql)
![Drizzle ORM](https://img.shields.io/badge/ORM-Drizzle-C5F74F?logo=drizzle)

---

## 1. Sobre o Projeto

O **Konnexy Ads** (`ads.konnexy.com.br`) foi projetado para negócios locais, gestores de tráfego e agências de performance que precisam escalar a operação de mídia paga com **segurança operacional, governança financeira e inteligência analítica**.

Diferente de ferramentas que executam alterações opacas em contas de anúncio, o Konnexy Ads opera sob o princípio de **Automação Supervisionada (Human-in-the-Loop)**:
- **Modo Somente Leitura por padrão (`READ_ONLY`)**.
- **IA Auditável**: Todos os diagnósticos apresentam evidências métricas, nível de risco, impacto estimado e justificativa validada por schema (`Zod`).
- **Kill Switch de Emergência**: Suspensão instantânea de todas as automações (com simulação explícita na interface durante a Foundation 1.1 e trava global/organizacional no `ExecutionEngine`).
- **Isolamento Multi-Tenant Estrito**: Segregação lógica via `organization_id`, chaves estrangeiras compostas `(organization_id, id)` e políticas de Row-Level Security (`USING` + `WITH CHECK`) com role de privilégio mínimo (`konnexy_app` sem `BYPASSRLS`) no Neon PostgreSQL.

---

## 2. Stack Tecnológica

| Camada | Tecnologia |
| :--- | :--- |
| **Framework Web** | Next.js 15.5.29 (App Router, Server Components, CSP & Security Headers) |
| **Linguagem** | TypeScript 5.8 (`strict: true`, `noUncheckedIndexedAccess: true`) |
| **Estilização & UI** | Tailwind CSS v4, Shadcn UI, Radix UI, Lucide Icons, Motion |
| **Visualização & Tabelas** | Recharts, TanStack Table v8 |
| **Formulários & Validação** | React Hook Form, Zod v4 |
| **Banco de Dados & ORM** | Neon PostgreSQL (`@neondatabase/serverless`), Drizzle ORM 0.45, Drizzle Kit |
| **Autenticação** | Auth.js v5 (`next-auth@5.0.0-beta.32`) + Sessões e Rate Limiting Persistentes no PostgreSQL (`/login`, `/onboarding`, Middleware) |
| **Inteligência Artificial** | Vercel AI SDK v6 (Abstração multi-modelo com saída estruturada) |
| **Automação & Jobs** | Vercel Cron, Vercel Workflow SDK Architecture |
| **Qualidade & Testes** | ESLint 9, Vitest 4, PGlite (PostgreSQL RLS & Operational Persistence), Playwright E2E + `@axe-core/playwright` |

---

## 3. Arquitetura do Sistema

O projeto adota **Monólito Modular** combinado com **Clean Architecture** e princípios **SOLID**:

- `src/app`: Rotas do Next.js App Router, layouts e páginas.
- `src/components`: Design System B2B (`ui/`, `dashboard/` modularizado em `AppSidebar`, `DashboardHeader`, `MobileNavigation`, `DashboardOverview`, `EmergencyStopControl` e `DemoModeBanner`).
- `src/application`: Casos de uso da aplicação (`getDashboardOverviewUseCase`), desacoplando apresentação e infraestrutura.
- `src/modules`: Módulos de negócio encapsulados (`organizations`, `ai`).
- `src/integrations`: Contratos separados `AdvertisingReadProvider` e `AdvertisingExecutionProvider` com Discriminated Unions + Zod (`MockAdsProvider`, `GoogleAdsProvider`).
- `src/automation`: Os 7 motores independentes (`RuleEngine`, `PolicyEngine`, `RiskEngine`, `SimulationEngine`, `ApprovalEngine`, `ExecutionEngine`, `AuditEngine`) + Máquina de Estados explícita (`RecommendationStateMachine`).
- `src/security`: RBAC com escopo por cliente (`CLIENT_VIEWER`), validação de variáveis de ambiente (`ServerEnvSchema`), Credential Vault (`AES-256-GCM` com versionamento de chaves e AAD), Proteção SSRF com validação DNS e Sanitização de Logs.
- `src/infrastructure`: Configuração do Drizzle ORM, schemas de banco de dados (22 domínios), wrapper transacional `withTenantTransaction`, repositórios tenant-scoped e migrations versionadas.

Documentação detalhada disponível em [`docs/`](./docs/):
- [Arquitetura (`docs/architecture.md`)](./docs/architecture.md)
- [Banco de Dados & RLS (`docs/database.md`)](./docs/database.md)
- [Segurança, Vault & Governança CI (`docs/security.md`)](./docs/security.md)
- [Integrações de Mídia (`docs/integrations.md`)](./docs/integrations.md)
- [Motor de Automações (`docs/automation-engine.md`)](./docs/automation-engine.md)
- [Roadmap (`docs/roadmap.md`)](./docs/roadmap.md)
- [Relatório de Hardening Foundation 1.1 (`docs/reviews/foundation-1.1-hardening-report.md`)](./docs/reviews/foundation-1.1-hardening-report.md)
- [Relatório Etapa 2.0 — Auth, Multi-Tenancy & Google Ads Read-Only (`docs/reviews/stage-2-auth-multitenancy-google-ads-report.md`)](./docs/reviews/stage-2-auth-multitenancy-google-ads-report.md)
- [Relatório Etapa 2.1 — Operational Completion (`docs/reviews/stage-2.1-operational-completion-report.md`)](./docs/reviews/stage-2.1-operational-completion-report.md)
- [ADRs (`docs/adr/`)](./docs/adr/)

---

## 4. Como Executar Localmente

### Pré-requisitos
- Node.js `>= 20.0.0`
- `pnpm` `>= 10.6.3`

### Passo a passo

1. **Instale as dependências**:
   ```bash
   pnpm install --frozen-lockfile
   ```

2. **Configure as variáveis de ambiente**:
   ```bash
   cp .env.example .env.local
   ```

3. **Inicie o servidor de desenvolvimento**:
   ```bash
   pnpm dev
   ```
   Acesse `http://localhost:3000`.

4. **Comandos de Qualidade, Auditoria e Verificação (Definition of Done)**:
   ```bash
   pnpm audit --audit-level=high   # Verifica zero vulnerabilidades altas ou críticas
   pnpm lint                       # Executa ESLint com limite zero de warnings
   pnpm typecheck                  # Verifica tipagem estrita do TypeScript
   pnpm test                       # Executa testes unitários + PostgreSQL RLS real (PGlite)
   pnpm build                      # Compila a aplicação para produção
   pnpm test:e2e                   # Executa testes Playwright em 5 viewports (320px a 1440px)
   ```
