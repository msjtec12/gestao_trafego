# Arquitetura de Banco de Dados — Neon PostgreSQL + Drizzle ORM

## 1. Visão Geral

O **Konnexy Ads** utiliza **Neon PostgreSQL** como banco de dados oficial e **Drizzle ORM** para modelagem tipada e migrations versionadas (`drizzle/migrations`).

### Princípios de Modelagem e Hardening Multi-Tenant (Foundation 1.1)
1. **Chaves Estrangeiras Compostas `(organization_id, id)`**:
   - Todas as tabelas operacionais possuem índice único composto `(organization_id, id)` e chaves estrangeiras compostas apontando para `(organization_id, id)` da entidade pai (ex.: `ad_accounts` → `clients`, `campaigns` → `ad_accounts`, `recommendations` → `campaigns`, `approvals` → `recommendations`, `execution_jobs` → `approvals` e `campaigns`).
   - Isso impede fisicamente no PostgreSQL qualquer relacionamento cruzado entre duas organizações diferentes.
2. **Row-Level Security (RLS) Obrigatório com `USING` e `WITH CHECK`**:
   - A migration `0001_multi_tenant_rls_hardening.sql` aplica `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY` em todas as tabelas operacionais.
   - As políticas validam tanto leitura (`USING`) quanto escrita/atualização (`WITH CHECK`) contra `NULLIF(current_setting('app.current_organization_id', true), '')::uuid`.
3. **Role de Aplicação de Menor Privilégio (`konnexy_app`)**:
   - Criada com `NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE`.
   - O wrapper `withTenantTransaction` (`src/infrastructure/db/index.ts`) executa `SET LOCAL ROLE konnexy_app` e `SELECT set_config('app.current_organization_id', orgId, true)` dentro de uma transação explícita, garantindo compatibilidade total com connection pooling (PgBouncer/Neon).
4. **Imutabilidade e Retenção de Logs de Auditoria (`audit_logs`)**:
   - A role `konnexy_app` tem privilégios `UPDATE` e `DELETE` revogados na tabela `audit_logs`.
   - O trigger `trg_protect_audit_logs` bloqueia qualquer `UPDATE` (`AUDIT_LOG_IMMUTABLE`) e bloqueia `DELETE` enquanto `retention_until > NOW()` (`AUDIT_LOG_RETENTION_LOCKED`).

---

## 2. Migrations Versionadas

| Migration | Propósito |
| :--- | :--- |
| `0000_confused_galactus.sql` | Criação dos 10 enums e das 22 tabelas de domínio iniciais. |
| `0001_multi_tenant_rls_hardening.sql` | Índices únicos compostos `(organization_id, id)`, chaves estrangeiras compostas multi-tenant, role `konnexy_app` (`NOBYPASSRLS`), políticas RLS (`USING` + `WITH CHECK`) e trigger de imutabilidade/retenção em `audit_logs`. |
| `0002_stage2_auth_rls_and_sync.sql` | FKs compostas em relacionamentos opcionais, `member_client_access` (`CLIENT_VIEWER`), `sync_runs`, `action_payload_hash` em `approvals` e privilégios granulares por tabela para `konnexy_app`. |
| `0003_stage2_1_operational_persistence.sql` | Tabelas persistentes `user_sessions`, `auth_rate_limits`, `oauth_states` (com RLS) e índices únicos compostos para upsert idempotente dos 9 domínios. |
| `0004_neon_pg17_role_set_and_runtime_role.sql` | Concessão dinâmica `GRANT konnexy_app TO current_user WITH SET TRUE, INHERIT FALSE` (compatível com Neon PostgreSQL 17 sem fixar o nome do owner), criação da role operacional de menor privilégio `konnexy_runtime` e criação da tabela `drizzle.__drizzle_migrations` para reconciliação não destrutiva. |

---

## 3. Roles PostgreSQL 17 (Neon) & Reconciliação de Migrations

1. **Correção do erro `SQLSTATE 42501` no PostgreSQL 17**:
   - A partir do PostgreSQL 16/17, o comando `SET LOCAL ROLE konnexy_app` exige permissão explícita `WITH SET TRUE`.
   - A migration `0004_neon_pg17_role_set_and_runtime_role.sql` executa dinamicamente `GRANT konnexy_app TO <current_user> WITH SET TRUE, INHERIT FALSE` usando `current_user` (sem fixar o nome da role proprietária entre staging, production ou preview branches).
2. **Role de Conexão Operacional de Menor Privilégio (`konnexy_runtime`)**:
   - Criada com `NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE` e `GRANT konnexy_app TO konnexy_runtime WITH SET TRUE, INHERIT FALSE`.
   - Para ativar o login em produção/staging no Neon, defina uma senha forte fora do código-fonte via Neon Console / Secret Manager (`ALTER ROLE konnexy_runtime WITH LOGIN PASSWORD '...';`) e aponte `DATABASE_URL` para a role `konnexy_runtime`.
3. **Reconciliação `_konnexy_migrations` ↔ `drizzle.__drizzle_migrations`**:
   - O módulo `src/infrastructure/db/migration-reconciler.ts` (`reconcileMigrationTrackingTables` e `generateDrizzleReconciliationSql`) sincroniza entradas já executadas em `_konnexy_migrations` com o controle oficial `drizzle.__drizzle_migrations` usando o hash SHA-256 exato de cada arquivo listado em `drizzle/migrations/meta/_journal.json`, garantindo que migrations já aplicadas (`0000` a `0003`) **nunca sejam reexecutadas** nem apaguem dados.

