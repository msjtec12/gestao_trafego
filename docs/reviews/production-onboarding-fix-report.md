# Konnexy Ads — Relatório de Correção do Onboarding em Produção (`ads.konnexy.com.br/onboarding`)

**Branch:** `fix/production-onboarding-neon-rls`
**Alvo:** `https://ads.konnexy.com.br/onboarding`
**Ambiente de Produção:** Vercel (Node.js 20+) + Neon PostgreSQL 17 (28 tabelas, 24 políticas RLS, `FORCE ROW LEVEL SECURITY` ativo, 4 migrations aplicadas, role `konnexy_app` configurada).

---

## 1. Diagnóstico das Causas Raiz

A mensagem genérica `"Não foi possível concluir o onboarding."` mascarava **5 problemas reais combinados** no fluxo de produção:

1. **Causa Raiz Primária — `SQLSTATE 42501` sob `FORCE ROW LEVEL SECURITY` no Neon PostgreSQL 17:**
   - A migration `0001_multi_tenant_rls_hardening.sql` ativa `ENABLE ROW LEVEL SECURITY` e **`FORCE ROW LEVEL SECURITY`** em `organizations`, `memberships`, `integrations`, `audit_logs` e `member_client_access`, exigindo `id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid` (ou `organization_id = ...`).
   - No Neon PostgreSQL 17, a role proprietária do banco (`konnexy_ads_owner`) **não é superuser**, portanto `FORCE ROW LEVEL SECURITY` é aplicado **mesmo nas conexões administrativas** (diferentemente do PGlite local com role `postgres` superuser).
   - O fluxo anterior inseria em `organizations`, `memberships`, `integrations` e `audit_logs` **sem executar `SELECT set_config('app.current_organization_id', organizationId, true)` dentro de uma transação**, disparando imediatamente `SQLSTATE 42501: new row violates row-level security policy for table "organizations"`.
   - O mesmo problema ocorreria logo após o redirecionamento para `/` em `resolveSessionFromPostgres`, `authenticateUserWithPostgres`, `revokeSessionInPostgres` e `switchActiveOrganizationInPostgres`.

2. **Falta de Atomicidade no Onboarding:**
   - `onboardOrganizationAction` usava `withAdminPostgresConnection` (sem `BEGIN ... COMMIT / ROLLBACK`), permitindo gravações parciais (`users` criado enquanto `organizations`/`memberships`/`integrations` falhavam) e impedindo que `set_config(..., true)` persistisse entre statements.

3. **Driver `@neondatabase/serverless` `Pool` no Runtime Node.js da Vercel:**
   - `Pool` do `@neondatabase/serverless` requer `neonConfig.webSocketConstructor = ws` para operar de forma determinística no runtime serverless Node.js 20 da Vercel.

4. **Cookie Auth.js v5 em Produção HTTPS (`ads.konnexy.com.br`):**
   - `issueUnifiedAuthJsSessionCookie` emitia `authjs.session-token` sem `secure: true` em produção HTTPS, e `resolveUnifiedAuthJsPostgresSession` usava salt fixo `authjs.session-token` mesmo quando `__Secure-authjs.session-token` estivesse presente.

5. **Mascaramento de Erro sem Telemetria Estruturada:**
   - O Drizzle ORM encapsula erros do PostgreSQL em `Error("Failed query: insert into ...")` colocando o `DatabaseError` real (com `code`, `constraint`, `table`) em `error.cause`.
   - `toPublicSafeErrorMessage` identificava `/insert\s+into\s+/i` e descartava silenciosamente a exceção sem emitir log estruturado no servidor, devolvendo sempre `"Não foi possível concluir o onboarding."`.

---

## 2. Correções Implementadas (Sem Recriar Banco, Sem Reaplicar Migrations, Sem Desativar RLS)

| Componente | Arquivo | Correção Aplicada |
|---|---|---|
| **Driver Neon Serverless Pool** | `src/infrastructure/db/index.ts`, `package.json` | Adicionado `ws` (`8.23.0`) + `@types/ws` e configurado `neonConfig.webSocketConstructor = ws`. Criado `withAdminPostgresTransaction` (`BEGIN ... COMMIT / ROLLBACK`). |
| **Onboarding Atômico + RLS PG17** | `src/infrastructure/db/repositories/drizzle-tenant-repositories.ts` | Pré-geração de `organizationId = crypto.randomUUID()` seguida de `SELECT set_config('app.current_organization_id', organizationId, true)` na transação antes de inserir `organizations`, `memberships` (`OWNER`), `user_sessions`, `integrations` e `audit_logs`. |
| **Sessão, Login, Logout & Switch sob `FORCE RLS`** | `src/infrastructure/db/repositories/drizzle-tenant-repositories.ts`, `src/security/auth.ts` | Todas as operações administrativas agora rodam em `withAdminPostgresTransaction` com `set_config('app.current_organization_id', targetOrgId, true)` antes de consultar/gravar em `memberships`, `organizations`, `member_client_access` e `audit_logs`. |
| **Logs Estruturados Sanitizados & Erros Específicos** | `src/security/structured-logger.ts`, `src/app/actions/operational-actions.ts`, `src/app/onboarding/page.tsx` | Extração recursiva de `error.cause` (`pgCode`, `constraint`, `table`), log JSON sanitizado com `requestId`, `flow`, `step`, `operation`, `category`, `pgCode`, `errorCode` (sem senhas, tokens, hashes ou connection strings) e mensagens seguras específicas para: banco indisponível, configuração ausente, e-mail duplicado, slug duplicado, permissão/RLS insuficiente e falha de autenticação. |
| **Cookie Auth.js HTTPS** | `src/security/auth-cookie-config.ts`, `src/security/auth.ts` | Em produção HTTPS / Vercel (`VERCEL === "1"` ou `https://`), emite `__Secure-authjs.session-token` com `secure: true`, `httpOnly: true`, `sameSite: "lax"` e `salt` correspondente; decodificação dual-salt compatível com HTTPS e localhost HTTP. |

---

## 3. Evidências de Testes Executados

| Verificação | Comando | Resultado |
|---|---|---|
| **Auditoria de Dependências** | `pnpm audit --audit-level=high` | **PASS** (0 vulnerabilidades high/critical) |
| **ESLint Strict** | `pnpm lint` (`--max-warnings 0`) | **PASS** (0 erros, 0 warnings) |
| **TypeScript Strict** | `pnpm typecheck` (`tsc --noEmit`) | **PASS** (0 erros) |
| **Unit & Integration (Vitest)** | `pnpm test` | **PASS** — 7 suítes, **55 testes aprovados**, 2 condicionais de Neon live pulados por ausência de credencial no ambiente local |
| **Reprodução Neon PG17 Non-Superuser `FORCE RLS`** | `src/tests/production-onboarding-neon-rls.test.ts` | **PASS** — Reproduziu `SQLSTATE 42501` com role `NOSUPERUSER NOBYPASSRLS`, provou sucesso atômico do onboarding + sessão + logout + relogin, provou rollback integral em falha intermediária, provou `DUPLICATE_EMAIL` / `DUPLICATE_SLUG` sob RLS e validou sanitização de logs e cookies `__Secure-` |
| **Build de Produção Next.js** | `pnpm build` | **PASS** (compilado e otimizado sem erros) |
| **Playwright E2E + Axe WCAG** | `pnpm test:e2e` | **PASS** — **8/8 cenários aprovados** (incluindo onboarding completo, cookie Auth.js, criação de cliente, logout/login e zero violações Axe) |
| **Neon Staging Live (`NEON_STAGING_DATABASE_URL`)** | `src/tests/production-onboarding-neon-rls.test.ts` | **`BLOCKED_BY_CREDENTIALS` no ambiente local** — suíte live já implementada e pronta para execução automática assim que `NEON_STAGING_DATABASE_URL` for fornecida no ambiente/CI (sem reaplicar migrations ou apagar dados). |
