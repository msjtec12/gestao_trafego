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
