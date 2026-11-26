# Relatório Técnico — Etapa 2.2: Production Readiness Hardening (Konnexy Ads)

- **Repositório**: `https://github.com/msjtec12/gestao_trafego`
- **Branch de Entrega**: `fix/stage-2-production-readiness`
- **Commit Auditado de Referência (`main`)**: `334b84067e92ceb88db83b2528db48f848db14a3`
- **Modo Operacional Padrão**: `READ_ONLY` (Somente Leitura — zero mutações em campanhas reais)

---

## 1. Sumário Executivo

A **Etapa 2.2: Production Readiness Hardening** resolveu integralmente os três bloqueadores críticos (`P0`), as inconsistências de isolamento multi-tenant e estabilidade de testes E2E (`P1`), as violações de contraste e semântica ARIA de impacto sério/crítico no `@axe-core/playwright` (`P2`) e a separação dos jobs de verificação no GitHub Actions CI.

> **Declaração de Prontidão e Transparência**: Nenhuma funcionalidade foi declarada pronta para produção com base exclusivamente em mocks ou PGlite. O runtime operacional agora **exige Neon PostgreSQL em produção** (falhando de forma controlada com `DatabaseConfigurationError` caso `DATABASE_URL` esteja ausente ou com placeholder) e bloqueia incondicionalmente o uso de PGlite na Vercel (`VERCEL=1`). A execução da suíte contra um cluster Neon remoto descartável (`NEON_DISPOSABLE_TEST_DATABASE_URL`) e o round-trip OAuth ao vivo contra o Google Cloud permanecem classificados como `BLOCKED_BY_CREDENTIALS` até o provisionamento dessas credenciais externas no ambiente de CI/Staging.

---

## 2. Registro Detalhado de Problemas Corrigidos (Arquivo, Localização, Evidência Anterior, Correção, Teste e Resultado)

### 2.1. [P0] Runtime PostgreSQL Operacional Utilizando PGlite e `any` Transacional
- **Arquivos e Localizações**:
  - `src/infrastructure/db/index.ts` (linhas 24–290)
  - `src/infrastructure/db/repositories/drizzle-tenant-repositories.ts` (linhas 77–505)
  - `src/integrations/google-ads/google-ads-oauth-and-readonly.ts` (linha 258)
  - `src/workflows/incremental-sync-engine.ts` (linha 163)
  - `src/security/auth-rate-limiter.ts` (linha 86)
  - `src/app/actions/operational-actions.ts`, `src/application/use-cases/dashboard-overview-use-case.ts`, `src/app/api/integrations/google-ads/*/route.ts`
- **Evidência Anterior**:
  - `getOperationalPostgresRuntime()` instanciava `new PGlite(".data/konnexy-pgdata")` como fallback padrão sempre que `DATABASE_URL` não estava configurada, tentando gravar em disco local na Vercel (`/var/task/.data/konnexy-pgdata`).
  - `withTenantTransaction` aceitava `contextOrOrgId: TenantContext | string` e tipava `tx: any` com `// eslint-disable-next-line @typescript-eslint/no-explicit-any`.
  - Repositórios e serviços continham 12 diretivas `eslint-disable-next-line @typescript-eslint/no-explicit-any`.
- **Correção Implementada**:
  - Removida `getOperationalPostgresRuntime()` do fluxo operacional e substituída por duas fronteiras explícitas e tipadas (`DrizzleQueryExecutor`, zero `any` e zero `eslint-disable` em `src/`):
    1. `withAdminPostgresConnection(callback)`: conexão administrativa dedicada para lookup de autenticação, onboarding e resolução/revogação de sessão em `user_sessions`.
    2. `withTenantTransaction(context, callback)`: exige obrigatoriamente um `TenantContext` autenticado (rejeita strings de `organizationId` isoladas), executa `SET LOCAL ROLE konnexy_app` e `SELECT set_config('app.current_organization_id', organizationId, true)` dentro da transação Neon Serverless `Pool`.
  - `validateRequiredDatabaseUrl()` e `isExplicitPgliteTestOrDevAllowed()` bloqueiam qualquer fallback para PGlite em produção (`NODE_ENV === "production"`) e bloqueiam incondicionalmente na Vercel (`VERCEL === "1"` ou `VERCEL_ENV` definido), lançando `DatabaseConfigurationError` (HTTP 503). PGlite só é permitido em testes/dev explicitamente configurados (`NODE_ENV === "test"` ou `KONNEXY_ALLOW_PGLITE_DEV === "true"` fora da Vercel).
- **Teste Executado e Resultado**:
  - `pnpm test:neon` (`src/tests/neon-driver-integration.test.ts`): verifica que `NODE_ENV=production` ou `VERCEL=1` lançam `DatabaseConfigurationError` sem fallback para PGlite (`PASSED`).
  - `pnpm lint` e `pnpm typecheck`: `0` diretivas `eslint-disable` em `src/` e `0` erros de compilação TypeScript (`PASSED`).

---

### 2.2. [P0] Fallbacks Fixos e Previsíveis de Secrets Criptográficos
- **Arquivos e Localizações**:
  - `src/security/env.ts` (linhas 1–208)
  - `src/app/actions/operational-actions.ts` (antiga função `getVaultKey()`, linhas 52–62)
  - `src/app/api/integrations/google-ads/authorize/route.ts` (antigas linhas 8–18 e 29–31)
  - `src/app/api/integrations/google-ads/callback/route.ts` (antigas linhas 8–18 e 44–46)
  - `.env.example` (linha 26)
- **Evidência Anterior**:
  - `getVaultKey()` retornava a chave hexadecimal fixa `"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"` quando `CREDENTIALS_ENCRYPTION_KEY` estava ausente.
  - Os Route Handlers OAuth do Google Ads utilizavam `"konnexy-ads-default-state-signing-secret-32chars"` como fallback de `stateSecret`.
- **Correção Implementada**:
  - Removidos todos os fallbacks fixos de chaves AES, `AUTH_SECRET` e segredos de assinatura OAuth de todo o código da aplicação.
  - Centralizada a validação fail-closed em `src/security/env.ts` com `requireCredentialsEncryptionKey()`, `requireAuthSecret()`, `requireOAuthStateSigningSecret()` e `requireGoogleAdsOAuthConfig()`, que lançam `MissingOrWeakSecretError` caso o segredo esteja ausente, tenha baixa entropia (`< 4` caracteres distintos) ou utilize prefixo de placeholder (`replace_with_*`).
  - Secrets de teste são injetados exclusivamente pelas fixtures de teste (`playwright.config.ts`, `.github/workflows/ci.yml` e arquivos `src/tests/*.test.ts`).
- **Teste Executado e Resultado**:
  - `src/tests/neon-driver-integration.test.ts` (`"strictly rejects missing, placeholder, or low-entropy secrets without hardcoded fallbacks"`): `PASSED`.

---

### 2.3. [P0] Arquitetura Paralela de Autenticação e Admin Baseado em Variáveis de Ambiente
- **Arquivos e Localizações**:
  - `src/security/auth.ts` (linhas 1–215)
  - `src/middleware.ts` (linhas 1–49)
  - `src/app/actions/operational-actions.ts` (linhas 54–170)
  - `src/app/page.tsx` (linhas 9–26)
- **Evidência Anterior**:
  - `src/security/auth.ts` configurava o Auth.js v5 lendo `ADMIN_BOOTSTRAP_EMAIL` e `ADMIN_BOOTSTRAP_PASSWORD_HASH` de variáveis de ambiente com `globalAuthRateLimiter` em memória, enquanto as páginas `/login` e `/onboarding` usavam um cookie separado `konnexy_session` desconectado do Auth.js.
- **Correção Implementada**:
  - Unificada toda a arquitetura de autenticação no **Auth.js v5** (`src/security/auth.ts`) utilizando o cookie oficial `authjs.session-token` (`AUTHJS_SESSION_COOKIE_NAME`).
  - Removidos completamente `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD_HASH` e o rate limiter em memória do fluxo de login.
  - O provider `Credentials` do Auth.js e as Server Actions de login/onboarding consultam exclusivamente a tabela `users` no PostgreSQL (com hash `scrypt` e rate limiting durável na tabela `auth_rate_limits`), criam um registro persistente em `user_sessions` (`ksess_*`) e emitem o JWT criptografado do Auth.js (`encode`/`decode` de `next-auth/jwt` com `AUTH_SECRET` validado) contendo o `dbSessionToken` vinculado ao banco.
  - **Garantia de Revogação e Expiração**: Em toda requisição autenticada (Server Components, Server Actions e Route Handlers), `resolveUnifiedAuthJsPostgresSession()` decodifica o token Auth.js e consulta `user_sessions` no PostgreSQL, rejeitando imediatamente qualquer sessão com `revoked_at IS NOT NULL` (logout) ou `expires_at <= now()`.
- **Teste Executado e Resultado**:
  - `e2e/dashboard.spec.ts` Teste #2: verifica emissão do cookie `authjs.session-token`, acesso autenticado a `/`, revogação no logout e novo login (`PASSED`).

---

### 2.4. [P1] Isolamento Multi-Tenant e Transações RLS no Dashboard Operacional
- **Arquivos e Localizações**:
  - `src/application/use-cases/dashboard-overview-use-case.ts` (linhas 146–420)
  - `src/infrastructure/db/index.ts` (`withTenantTransaction`)
- **Evidência Anterior**:
  - `getAuthenticatedOperationalDashboardUseCase` executava queries diretamente na conexão geral sem abrir `withTenantTransaction(session.context, ...)` e consultava `daily_metrics` filtrando apenas por `inArray(campaignId, campaignIds)` sem filtro explícito de `organization_id`.
- **Correção Implementada**:
  - Todas as consultas operacionais do dashboard autenticado e todas as Server Actions operacionais (`createClientServerAction`, `updateClientServerAction`, `deactivateClientServerAction`, `toggleAdAccountSelectionServerAction`, `revokeIntegrationServerAction`, `toggleEmergencyStopServerAction`, `requestSyncServerAction`) e Route Handlers OAuth agora executam **obrigatoriamente dentro de `withTenantTransaction(session.context, async (tx) => ...)`**, ativando `SET LOCAL ROLE konnexy_app` e `set_config('app.current_organization_id', session.context.organizationId, true)` com filtro explícito `eq(schema.dailyMetrics.organizationId, session.context.organizationId)`.
- **Teste Executado e Resultado**:
  - `pnpm test:pglite` (`src/tests/postgres-rls-integration.test.ts` e `src/tests/stage2-1-operational-completion.test.ts`): `10/10 PASSED`.

---

### 2.5. [P1 & P2] Estabilidade do Playwright E2E e Correção de Violações Sérias de Acessibilidade (`@axe-core/playwright`)
- **Arquivos e Localizações**:
  - `src/app/globals.css` (linha 2)
  - `src/components/dashboard/tenant-management-hub.tsx` (linhas 66–135, 290–345, 438–485)
  - `src/components/ui/badge.tsx`, `src/components/ui/button.tsx`, `src/components/ui/card.tsx`, `src/components/dashboard/demo-mode-banner.tsx`, `src/components/dashboard/command-palette.tsx`
  - `e2e/dashboard.spec.ts` (linhas 1–230)
- **Evidência Anterior**:
  1. No Tailwind CSS v4 (`@import "tailwindcss";`), a ausência de `@custom-variant dark (&:where(.dark, .dark *));` fazia com que as classes `dark:*` obedecessem à media query `prefers-color-scheme` do navegador (que no Chromium headless do Playwright é `light`) em vez da classe `.dark` aplicada pelo `next-themes` no `<html>`. Isso gerava 36 violações `serious` de contraste (`color-contrast`) no Axe.
  2. Em `TenantManagementHub`, a criação de cliente via Server Action chamava `router.refresh()` sem sincronizar o retorno imediato da Server Action com o estado renderizado dos cards e o teste usava `getByText(clientName).first()`, que colidia com o `<option>` oculto dentro do `<select id="client-selector">`.
  3. As abas `role="tab"` em `TenantManagementHub` não possuíam `aria-controls` vinculado a um `role="tabpanel"` e o input de busca do `CommandPalette` não possuía `aria-label`.
- **Correção Implementada**:
  1. Adicionado `@custom-variant dark (&:where(.dark, .dark *));` em `src/app/globals.css` e ajustadas as paletas de `Badge`, `Button`, `CardDescription` e `DemoModeBanner` para contraste WCAG 2.1 AA (`>= 4.5:1`).
  2. `createClientServerAction` agora retorna o registro recém-persistido no PostgreSQL, `TenantManagementHub` atualiza a lista sincronizada imediatamente além de disparar `router.refresh()`, e cada card de cliente possui identificador único `data-testid="client-card-name-${client.id}"`.
  3. Adicionados `aria-controls`, `role="tabpanel"` e `aria-labelledby` nas abas do `TenantManagementHub` e `aria-label` no input do `CommandPalette`.
  4. Ampliada a verificação `assertNoSeriousOrCriticalAxeViolations` em `e2e/dashboard.spec.ts` para bloquear tanto violações `critical` quanto `serious` em `/login`, `/onboarding`, Dashboard Operacional Autenticado (`/`), Ambiente Demonstrativo (`/demo`) e diálogo `CommandPalette`.
- **Teste Executado e Resultado**:
  - `pnpm test:e2e --retries=0` executado repetidamente: **8/8 testes aprovados** em todas as execuções consecutivas, com **0 violações críticas ou sérias** no `@axe-core/playwright`.

---

## 3. Matriz de Conformidade e Limitações Remanescentes

| Item | Status | Observação Técnica |
| :--- | :---: | :--- |
| Runtime PostgreSQL sem fallback PGlite em produção/Vercel | `IMPLEMENTED_AND_VERIFIED` | `validateRequiredDatabaseUrl` + `isExplicitPgliteTestOrDevAllowed` testados em `src/tests/neon-driver-integration.test.ts` |
| Eliminação total de fallbacks de secrets em código de aplicação | `IMPLEMENTED_AND_VERIFIED` | Centralizado em `src/security/env.ts` (`MissingOrWeakSecretError`) |
| Autenticação unificada em Auth.js v5 com revogação no PostgreSQL | `IMPLEMENTED_AND_VERIFIED` | Cookie `authjs.session-token` vinculado a `user_sessions` no PostgreSQL |
| Isolamento Multi-Tenant com RLS em todas as transações operacionais | `IMPLEMENTED_AND_VERIFIED` | `withTenantTransaction` exigindo `TenantContext` autenticado e zero `any` |
| Estabilidade Playwright E2E (`--retries=0`) e Acessibilidade Axe (`critical` + `serious`) | `IMPLEMENTED_AND_VERIFIED` | 8/8 testes E2E aprovados repetidamente sem retries |
| Execução ao vivo contra cluster Neon PostgreSQL remoto descartável | `BLOCKED_BY_CREDENTIALS` | Suíte `src/tests/neon-driver-integration.test.ts` pronta (`pnpm test:neon`); requer `NEON_DISPOSABLE_TEST_DATABASE_URL` no ambiente |
| Round-trip OAuth 2.0 e GAQL ao vivo contra servidores Google Ads | `BLOCKED_BY_CREDENTIALS` | Transporte HTTPS IP-pinned e persistência Vault verificados; requer `GOOGLE_ADS_CLIENT_ID` e `GOOGLE_ADS_CLIENT_SECRET` oficiais |

---

## 4. Instruções para Proteção da Branch `main` no GitHub (Git Governance)

Conforme documentado em `AGENTS.md` (`## Git Governance — Branch Protection`), configure o **GitHub Ruleset** para a branch `main` em `Settings → Rules → Rulesets`:
1. **Target branch**: `main`.
2. **Restrict deletions** e **Block force pushes**: Habilitados.
3. **Require a pull request before merging**:
   - Required approvals: `1` (somente o proprietário do projeto autoriza o merge após auditoria técnica independente).
   - Dismiss stale pull request approvals when new commits are pushed: Habilitado.
4. **Require status checks to pass before merging**:
   - Require branches to be up to date before merging: Habilitado.
   - Status check obrigatório: `Audit, Secret Scan, Lint, Typecheck, Unit, PostgreSQL RLS, Build & Playwright` (`.github/workflows/ci.yml`).
