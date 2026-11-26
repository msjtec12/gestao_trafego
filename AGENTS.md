# AGENTS.md — Konnexy Ads Engineering Guidelines

## 1. Visão Geral
O **Konnexy Ads** (`ads.konnexy.com.br`) é uma plataforma SaaS multi-tenant B2B para gerenciamento centralizado, análise inteligente, monitoramento e automação supervisionada de campanhas de tráfego pago (Google Ads, Meta Ads, Microsoft Ads e Mock Provider).

## 2. Regras Invioláveis para Agentes e Engenheiros
1. **Stack Obrigatória**:
   - Next.js App Router + TypeScript Strict (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`).
   - Tailwind CSS v4 + Shadcn/Radix UI + Lucide Icons + Motion + Recharts + TanStack Table.
   - Neon PostgreSQL + Drizzle ORM (Proibido utilizar Supabase).
   - Auth.js v5 para autenticação.
   - Vercel AI SDK com validação obrigatória via `Zod`.
   - `pnpm` como gerenciador de pacotes exclusivo.
2. **Isolamento Multi-Tenant**:
   - Toda entidade de negócio pertence a um `organization_id`.
   - Nenhuma query de leitura ou escrita pode executar sem filtro explícito de `organization_id` validado na sessão do servidor.
3. **Segurança em Automação e IA**:
   - **Modo Padrão**: `READ_ONLY` (Somente Leitura).
   - **Proibição de Execução Direta por IA**: Modelos de IA (LLMs) **jamais** podem invocar métodos que alterem campanhas reais. Eles apenas produzem recomendações estruturadas (`RecommendationSchema`) que passam pelo fluxo:
     `Coleta → Normalização → Análise → Recomendação → Validação → Aprovação → Execução → Verificação → Auditoria`.
   - **Emergency Kill Switch**: O sistema possui trava de emergência por organização e global que suspende imediatamente qualquer job ou regra automatizada.
4. **Qualidade e Versionamento**:
   - Nunca desativar regras de TypeScript ou ESLint para forçar build.
   - Nunca enviar commits diretamente para `main` sem Pull Request e validação completa (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`).
   - Nunca versionar arquivos `.env` ou segredos reais.
   - Dados demonstrativos (`MockAdsProvider`) devem ser explicitamente sinalizados na interface e nos payloads com `isDemoData: true`.

## 3. Estrutura Arquitetural (Monólito Modular + Clean Architecture)
```text
src/
├── app/                  # Next.js App Router (Presentation Entrypoints & Routes)
├── components/           # Design System, UI Primitives (Shadcn/Radix) & Layout
├── domain/               # Core Cross-Cutting Domain Types & Value Objects
├── application/          # Application Services & Orchestration Contracts
├── infrastructure/       # Database (Drizzle + Neon), Logging, Cache, Config
├── integrations/         # AdvertisingProvider Interface, GoogleAds, MockAds, MetaAds
├── security/             # RBAC, Multi-Tenant Guard, Credential Vault, Rate Limiter, LGPD
├── automation/           # Rule, Policy, Risk, Approval, Simulation, Execution & Audit Engines
├── workflows/            # Durable Scheduled & Event Workflows
└── modules/              # Vertical Feature Modules (organizations, campaigns, ai-insights, etc.)
```

## Git Governance — Branch Protection

- A branch main é protegida por GitHub Rulesets.
- É proibido realizar push diretamente na main.
- Toda implementação deve ocorrer em branches feat/*, fix/* ou chore/*.
- Toda entrega deve possuir um Pull Request.
- Todos os checks obrigatórios do GitHub Actions devem ser aprovados.
- O agente não possui autorização para realizar merge.
- A aprovação do CI não substitui a auditoria técnica independente.
- Somente o proprietário do projeto poderá autorizar o merge após a revisão.
- É proibido desativar, contornar ou modificar as regras de proteção para concluir uma tarefa.

