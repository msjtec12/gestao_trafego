# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.1.1] - 2026-11-26 — Foundation 1.1: Security Hardening

### Segurança (Fase A & Fase C)
- **Remediação Completa de Vulnerabilidades de Dependências**:
  - Atualização de `next` (`15.2.1` → `15.5.29`), `eslint-config-next` (`15.5.29`), `next-auth` (`5.0.0-beta.25` → `5.0.0-beta.32`), `drizzle-orm` (`0.40.1` → `0.45.4`), `drizzle-kit` (`0.30.6` → `0.31.11`), `zod` (`3.25.76` → `4.6.7`), `ai` (`6.0.338`), `@ai-sdk/openai` (`3.0.147`) e `vitest` (`4.1.12`).
  - Redução de **69 vulnerabilidades (10 críticas, 23 altas)** para **0 críticas e 0 altas**.
  - Remoção de `|| true` do comando `pnpm audit --audit-level=high` no GitHub Actions.
- **Credential Vault AES-256-GCM com Versionamento e AAD**:
  - Suporte a keyring versionado (`v1:iv:tag:ciphertext`), validação de entropia da chave e vinculação criptográfica (AAD) com `organizationId` e `integrationId`.
- **Proteção SSRF Avançada com Resolução DNS**:
  - Implementação de `resolveAndValidateSafeExternalUrl` com inspeção de registros DNS (`dns.lookup`) contra DNS rebinding para IPs IPv4/IPv6 privados/reservados e bloqueio de redirecionamentos (`redirect: "error"`).
- **Validação de Variáveis de Ambiente (`ServerEnvSchema`)**:
  - Rejeição automática de secrets demonstrativos (`replace_with_*`, chaves zeradas ou de baixa entropia) quando `NODE_ENV=production`.
- **RBAC Client-Scoped e Fail-Closed**:
  - Alinhamento da permissão `organization:manage_billing` para `ADMIN` e `OWNER`.
  - Implementação de `assertClientScopeAccess` para restringir `CLIENT_VIEWER` apenas aos clientes autorizados (`allowedClientIds`).
- **Headers de Segurança & CSP**:
  - Adição de `Content-Security-Policy` e `Cross-Origin-Opener-Policy` em `next.config.ts`.

### Banco de Dados & Multi-Tenancy (Fase B)
- **Migration Incremental `0001_multi_tenant_rls_hardening.sql`**:
  - Criação de índices únicos compostos `(organization_id, id)` e chaves estrangeiras compostas em todas as tabelas relacionais para impedir vínculos cruzados entre organizações distintas.
  - Criação da role `konnexy_app` (`NOBYPASSRLS NOSUPERUSER`) e ativação de `ENABLE` + `FORCE ROW LEVEL SECURITY` com políticas `USING` e `WITH CHECK` baseadas em `current_setting('app.current_organization_id', true)::uuid`.
  - Trigger `trg_protect_audit_logs` e revogação de `UPDATE`/`DELETE` em `audit_logs` para garantir imutabilidade e retenção (`retention_until`).
- **Contexto Transacional Neon & Repositórios**:
  - Wrapper `withTenantTransaction` com `SET LOCAL ROLE konnexy_app` e `set_config(..., true)` compatível com connection pooling.
  - Implementação de `TenantScopedRepository` e `validateTenantEntityChain`.

### Motor de Automações, TypeScript & UI (Fases D, E, F, G, H)
- **Separação dos 7 Motores + Máquina de Estados**:
  - `RuleEngine` agora ignora regras desativadas (`isEnabled: false`) e avalia métricas na janela temporal configurada (`timeWindowDays`: 3d, 7d, 14d, 30d).
  - `ApprovalEngine` valida objetos `ApprovalRecord` estruturados (expiração, correspondência de campanha/ação/organização e papel RBAC do aprovador).
  - `ExecutionEngine` com lock de idempotência concorrente (`IN_FLIGHT` + `COMPLETED`), trava de Kill Switch global e por organização, verificação independente pós-execução (`verifyMutation`) e bloqueio estrito de providers não simulados.
  - `RecommendationStateMachine` governando transições explícitas de estado.
- **Refatoração Modular e Acessibilidade do Dashboard**:
  - Extração de `AppSidebar`, `DashboardHeader`, `MobileNavigation`, `DashboardOverview`, `EmergencyStopControl` e `DemoModeBanner`.
  - Identificação explícita do Kill Switch da UI como simulação local enquanto a persistência de servidor permanece agendada para a Etapa 2.
- **Testes Reais em PostgreSQL Descartável & Playwright Multi-Viewport**:
  - 33 testes no Vitest (incluindo integração SQL real com `PGlite` validando RLS, FKs compostas e `audit_logs`) e 7 testes E2E no Playwright cobrindo teclado e responsividade (`320px`, `375px`, `768px`, `1024px`, `1440px`).

## [0.1.0] - 2026-11-26 — Foundation Release
- Entrega inicial da estrutura modular, schema Drizzle de 22 domínios e dashboard demonstrativo.
