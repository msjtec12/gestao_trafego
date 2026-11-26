# Konnexy Ads

> **Plataforma SaaS Multi-Tenant para Gestão Centralizada, Inteligência Artificial Auditável e Automação Supervisionada de Tráfego Pago.**

[![CI Pipeline](https://github.com/mslol21/konnexy-ads/actions/workflows/ci.yml/badge.svg)](https://github.com/mslol21/konnexy-ads/actions)
![TypeScript Strict](https://img.shields.io/badge/TypeScript-Strict-007ACC?logo=typescript&logoColor=white)
![Next.js 15](https://img.shields.io/badge/Next.js-15_App_Router-000000?logo=next.js)
![Neon PostgreSQL](https://img.shields.io/badge/Database-Neon_PostgreSQL-00E599?logo=postgresql)
![Drizzle ORM](https://img.shields.io/badge/ORM-Drizzle-C5F74F?logo=drizzle)

---

## 1. Sobre o Projeto

O **Konnexy Ads** (`ads.konnexy.com.br`) foi projetado para negócios locais, gestores de tráfego e agências de performance que precisam escalar a operação de mídia paga com **segurança operacional, governança financeira e inteligência analítica**.

Diferente de ferramentas que executam alterações opacas em contas de anúncio, o Konnexy Ads opera sob o princípio de **Automação Supervisionada (Human-in-the-Loop)**:
- **Modo Somente Leitura por padrão (`READ_ONLY`)**.
- **IA Auditável**: Todos os diagnósticos apresentam evidências métricas, nível de risco, impacto estimado e justificativa validada por schema (`Zod`).
- **Kill Switch de Emergência**: Suspensão instantânea de todas as automações em 1 clique.
- **Isolamento Multi-Tenant Estrito**: Segregação lógica via `organization_id` e políticas compatíveis com Row-Level Security (RLS) no Neon PostgreSQL.

---

## 2. Stack Tecnológica

| Camada | Tecnologia |
| :--- | :--- |
| **Framework Web** | Next.js 15 (App Router, Server Components, Server Actions) |
| **Linguagem** | TypeScript 5.8 (`strict: true`, `noUncheckedIndexedAccess: true`) |
| **Estilização & UI** | Tailwind CSS v4, Shadcn UI, Radix UI, Lucide Icons, Motion |
| **Visualização & Tabelas** | Recharts, TanStack Table v8 |
| **Formulários & Validação** | React Hook Form, Zod |
| **Banco de Dados & ORM** | Neon PostgreSQL, Drizzle ORM, Drizzle Kit |
| **Autenticação** | Auth.js v5 (NextAuth) |
| **Inteligência Artificial** | Vercel AI SDK (Abstração multi-modelo com saída estruturada) |
| **Automação & Jobs** | Vercel Cron, Vercel Workflow SDK Architecture |
| **Qualidade & Testes** | ESLint 9, Vitest, Testing Library, Playwright |

---

## 3. Arquitetura do Sistema

O projeto adota **Monólito Modular** combinado com **Clean Architecture** e princípios **SOLID**:

- `src/app`: Rotas do Next.js App Router, layouts e páginas.
- `src/components`: Design System B2B (`ui/`, `layout/`, `dashboard/`).
- `src/modules`: Módulos de negócio encapsulados (`organizations`, `campaigns`, `automation`, `ai`, `audit`).
- `src/integrations`: Contrato `AdvertisingProvider` e adaptadores (`GoogleAdsProvider`, `MockAdsProvider`, `MetaAdsProvider`, `MicrosoftAdsProvider`).
- `src/automation`: Motores de Regra, Política, Risco, Simulação, Aprovação, Execução e Auditoria.
- `src/security`: RBAC, Isolamento Multi-Tenant, Criptografia de Credenciais (AES-256-GCM), Proteção SSRF e Sanitização de Logs.
- `src/infrastructure`: Configuração do Drizzle ORM, schemas de banco de dados (22 domínios) e migrations versionadas.

Documentação detalhada disponível em [`docs/`](./docs/):
- [Arquitetura (`docs/architecture.md`)](./docs/architecture.md)
- [Banco de Dados (`docs/database.md`)](./docs/database.md)
- [Segurança & LGPD (`docs/security.md`)](./docs/security.md)
- [Integrações de Mídia (`docs/integrations.md`)](./docs/integrations.md)
- [Motor de Automações (`docs/automation-engine.md`)](./docs/automation-engine.md)
- [Roadmap (`docs/roadmap.md`)](./docs/roadmap.md)
- [ADRs (`docs/adr/`)](./docs/adr/)

---

## 4. Como Executar Localmente

### Pré-requisitos
- Node.js `>= 20.0.0`
- `pnpm` `>= 10.0.0`

### Passo a passo

1. **Instale as dependências**:
   ```bash
   pnpm install
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

4. **Comandos de Qualidade e Verificação**:
   ```bash
   pnpm lint          # Executa ESLint com limite zero de warnings
   pnpm typecheck     # Verifica tipagem estrita do TypeScript
   pnpm test          # Executa suíte de testes unitários e de arquitetura (Vitest)
   pnpm build         # Compila a aplicação para produção
   pnpm db:generate   # Gera migrations SQL a partir do schema Drizzle
   ```

---

## 5. Status da Entrega Atual: Etapa 1 — Foundation

- [x] Inicialização do projeto com Next.js 15, TypeScript Strict e Tailwind CSS v4.
- [x] Design System SaaS B2B (Dark/Light Mode, Deep Blue & Cyan accent, Command Palette `Ctrl+K`, Sidebar recolhível, Navegação responsiva, PWA Manifest seguro).
- [x] Dashboard Demonstrativo claramente identificado (`MODO DEMONSTRAÇÃO / MOCK PROVIDER`) com KPIs, gráficos Recharts, tabela TanStack com filtro/ordenação/paginação, recomendações de IA estruturadas e Kill Switch de emergência.
- [x] Modelagem Drizzle ORM contemplando os 22 domínios obrigatórios com `organization_id`, índices e migration inicial gerada.
- [x] Contratos e implementações base de Segurança (RBAC, Tenant Isolation), Integrações (`AdvertisingProvider`, `MockAdsProvider`, `GoogleAdsProvider` skeleton), IA (`Zod` schemas) e Motor de Automação (9 estágios + Circuit Breaker).
- [x] Suíte de testes automatizados (isolamento multi-tenant, RBAC, motor de regras, idempotência e falhas de integração) e pipeline CI no GitHub Actions.
