# Relatório Técnico de Entrega — Etapa 2.0: Authentication, Multi-Tenancy & Google Ads Read-Only

- **Projeto**: Konnexy Ads (`ads.konnexy.com.br`)
- **Repositório Oficial**: `https://github.com/msjtec12/gestao_trafego`
- **Commit de Referência**: `202821309d4a7852b258449f47f000a76015cb66`
- **Branch de Desenvolvimento**: `feat/stage-2-auth-multitenancy-google-ads`
- **Data da Entrega**: 2026-11-26

---

## 1. Resumo Executivo

A **Etapa 2.0** consolida o tratamento das ressalvas remanescentes da auditoria Foundation 1.1 e implementa as camadas de **Autenticação Server-Side (Auth.js v5)**, **Multi-Tenancy Persistente com Drizzle ORM e PostgreSQL RLS**, **Central de Gestão Multi-Tenant (Organizações, Membros, Clientes, Contas MCC, Integrações e Configurações)**, **Integração OAuth 2.0 Read-Only da Google Ads API com Credential Vault AES-256-GCM + AAD Obrigatório**, **Motor de Sincronização Incremental e Idempotente** e **Dashboard Operacional com Seletores Multi-Tenant e Identidade Visual Oficial**.

---

## 2. Alterações Realizadas por Fase

### Fase 1 — Correções Remanescentes da Auditoria Foundation 1.1
1. **Remoção total da aprovação alternativa por boolean**:
   - O método `SupervisedExecutionEngine.executeApprovedMutation` (`src/automation/engines/automation-engine.ts`) não aceita mais `isExplicitlyApproved?: boolean`. Toda execução exige obrigatoriamente um objeto `ApprovalRecord` estruturado.
2. **Vinculação criptográfica de aprovações ao conteúdo imutável da ação (`actionPayloadHash`)**:
   - Implementado `computeActionPayloadHash` (`src/security/vault-and-guards.ts`) com serialização JSON canônica (chaves ordenadas recursivamente) + hash SHA-256 de `(organizationId, campaignId, actionType, payload)`.
   - Caso o payload seja modificado após a emissão da aprovação, o `ApprovalEngine` bloqueia imediatamente com erro `actionPayloadHash mismatch`.
   - Adicionada coluna `action_payload_hash VARCHAR(64) NOT NULL` na tabela `approvals`.
3. **Conclusão das constraints multi-tenant nos relacionamentos opcionais**:
   - Adicionadas as chaves estrangeiras compostas na migration `drizzle/migrations/0002_stage2_auth_rls_and_sync.sql`:
     - `search_terms_org_ad_group_fk` (`organization_id, ad_group_id` → `ad_groups(organization_id, id)`)
     - `budgets_org_campaign_fk` (`organization_id, campaign_id` → `campaigns(organization_id, id)`)
     - `automation_runs_org_campaign_fk` (`organization_id, campaign_id` → `campaigns(organization_id, id)`)
4. **Restrição de privilégios PostgreSQL por tabela**:
   - Revogado `ALL PRIVILEGES` genérico de `konnexy_app` e concedidos privilégios estritos por tabela: tabelas append-only (`audit_logs`, `automation_runs`, `daily_metrics`, `search_terms`) possuem exclusivamente `SELECT, INSERT` (sem `UPDATE` nem `DELETE`). As tabelas operacionais (`clients`, `campaigns`, `organizations`, etc.) possuem `SELECT, INSERT, UPDATE` (sem `DELETE` físico pela role de aplicação).
5. **Proteção de acesso ao banco por contexto autenticado**:
   - Implementado `assertAuthenticatedDbContext` (`src/infrastructure/db/index.ts`), exigindo `TenantContext` autenticado antes de abrir transação ou executar métodos do `PersistentDrizzleTenantRepository`.
6. **Melhoria da proteção SSRF no transporte HTTP e sanitização de mensagens de erro**:
   - `validateSafeExternalUrl` agora bloqueia portas não padrão (`!= 443`) e `resolveAndValidateSafeExternalUrl` retorna `pinnedAddress` e cabeçalho `X-Pinned-Remote-Address` para eliminar a janela TOCTOU de DNS rebinding entre a resolução DNS e o transporte HTTP.
   - Implementado `toPublicSafeErrorMessage` (`src/security/vault-and-guards.ts`), impedindo vazamento de connection strings (`postgresql://`), queries SQL, caminhos de arquivo ou stack traces.
7. **Verificação pós-execução obrigatória**:
   - `SupervisedExecutionEngine` agora falha caso o provedor não implemente `verifyMutation`.

### Fase 2 — Autenticação (Auth.js v5 + Onboarding + Rate Limiting)
1. **Auth.js v5 (`src/security/auth.ts` & `src/app/api/auth/[...nextauth]/route.ts`)**:
   - Configurado com sessão JWT de tempo de vida estrito (`8 horas`), validação Zod de credenciais, hash de senha com `scrypt` + salt aleatório de 16 bytes e comparação em tempo constante (`crypto.timingSafeEqual`).
2. **Validação Server-Side Autoritativa (`src/security/session-guard.ts`)**:
   - `resolveAuthoritativeTenantContext` valida a expiração da sessão no servidor, rejeita tentativas de spoofing de `userId`, ignora completamente qualquer `role` enviado pelo navegador e resolve o papel exclusivamente a partir do registro de `memberships` do servidor.
3. **Onboarding Seguro da Primeira Organização (`onboardFirstOrganizationRepository`)**:
   - Cria usuário com consentimento LGPD, organização inicial obrigatoriamente em modo `READ_ONLY`, vínculo `OWNER` em `memberships` e registro em `audit_logs`.
4. **Proteção contra Abuso de Autenticação (`src/security/auth-rate-limiter.ts`)**:
   - `AuthAbuseRateLimiter` bloqueia tentativas repetidas após o limite configurável de falhas.

### Fase 3 — Multi-Tenancy Real (Repositórios Drizzle Persistentes)
1. **Repositório Drizzle Persistente (`src/infrastructure/db/repositories/drizzle-tenant-repositories.ts`)**:
   - Implementado `PersistentDrizzleTenantRepository` com `listClients`, `createClient`, `assignClientToViewer`, `listCampaigns` e `upsertSyncedCampaign`.
   - Nova tabela `member_client_access` com RLS e FKs compostas para persistir o vínculo entre membros `CLIENT_VIEWER` e clientes permitidos.

### Fase 4 — Gestão de Clientes e Governança Multi-Tenant
1. **Central Multi-Tenant (`src/components/dashboard/tenant-management-hub.tsx`)**:
   - Interface responsiva com 5 abas acessíveis (`role="tablist"`):
     - **Clientes**: Formulário validado por Zod (`CreateClientFormSchema`), listagem de clientes com teto mensal e meta de CPA e empty state.
     - **Contas de Anúncios & MCC**: Listagem de contas individuais e subcontas vinculadas a MCC (`login-customer-id`), moeda, fuso horário e botão de seleção/autorização para sincronização.
     - **Integrações & Google Ads OAuth**: Status real das integrações, indicação de criptografia Vault `AES-256-GCM + AAD`, checkpoint incremental e botão de revogação imediata de credenciais.
     - **Membros & Permissões RBAC**: Tabela de membros exibindo os 5 papéis e o escopo restrito de `CLIENT_VIEWER`.
     - **Organização, Governança & Auditoria**: Parâmetros da organização e trilha de auditoria em tempo real.

### Fase 5 — Google Ads API (OAuth 2.0 Read-Only, MCC & Vault AAD)
1. **Serviço `GoogleAdsReadOnlyIntegrationService` (`src/integrations/google-ads/google-ads-oauth-and-readonly.ts`)**:
   - Fluxo OAuth 2.0 com **PKCE (`S256`)** e `state` assinado via **HMAC-SHA256** vinculado a `organizationId`, `userId`, `nonce` e janela de expiração de 10 minutos (`createGoogleAdsOAuthAuthorizationRequest` e `verifyGoogleAdsOAuthState`).
   - Armazenamento de tokens exclusivamente via `encryptVaultCredentialWithMandatoryAad` (`aad: { organizationId, integrationId }`), jamais retornando tokens brutos ou criptografados para a camada de apresentação.
   - Suporte a contas individuais e **MCC (`login-customer-id`)** (`buildGoogleAdsReadOnlyHeaders`), seleção de contas autorizadas (`selectAuthorizedAccounts`) e revogação imediata (`revokeIntegration`).
   - Executor GAQL `executeReadOnlyGaqlQuery` com paginação (`nextPageToken`), retry exponencial em erros transitórios (`429`) e **bloqueio estrito de qualquer comando não-SELECT ou de mutação**.
   - Transparência de bloqueio quando `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_DEVELOPER_TOKEN` não estão configurados no ambiente (`BLOCKED_MISSING_CREDENTIALS`), sem jamais inventar conexão real.

### Fase 6 — Sincronização Incremental e Idempotente
1. **Motor `IncrementalAdsSyncEngine` (`src/workflows/incremental-sync-engine.ts`)**:
   - Sincroniza de forma idempotente os 9 domínios: Contas de anúncios, Campanhas, Grupos de anúncios, Anúncios, Palavras-chave, Termos de pesquisa, Conversões, Métricas diárias e Orçamentos.
   - Lock de concorrência por conta (`SKIPPED_CONCURRENT_LOCK`), persistência de `checkpointToken`, conversão exata de `cost_micros` para centavos (`convertGoogleAdsMicrosToCents`) e cálculo de CTR, CPC, CPA e ROAS.
   - Definição de job agendado (`SCHEDULED_GOOGLE_ADS_SYNC_JOB`) com `enabledInProduction: false`.

### Fase 7 — Dashboard Operacional & Identidade Visual Oficial
1. **Seletores Operacionais e Diferenciação Semântica de Métricas (`src/components/dashboard/dashboard-overview.tsx`)**:
   - Adicionados seletores de **Organização**, **Cliente**, **Conta de Anúncios** e **Janela Temporal** (`3d`, `7d`, `14d`, `30d`).
   - Adicionados cards de **Investimento, Conversões, CPA, CPC, CTR e ROAS**, estado/horário da última sincronização e badges de saúde das integrações.
   - Diferenciação explícita entre valor zero (`0` / `R$ 0,00`), ausência de dados (`Sem dados` ao selecionar o tenant operacional sem credenciais Google Ads conectadas) e métrica matematicamente indisponível (`N/D (0 conv.)`, `N/D (0 cliques)`).
   - Aplicação da **Logo Oficial Konnexy Ads** (`/konnexy-logo.jpg`) na Sidebar.

---

## 3. Migrations Versionadas

| Migration | Descrição |
| :--- | :--- |
| `0000_confused_galactus.sql` | Criação inicial dos 22 domínios multi-tenant. |
| `0001_multi_tenant_rls_hardening.sql` | Índices únicos compostos `(organization_id, id)`, FKs compostas obrigatórias, role `konnexy_app` (`NOBYPASSRLS`), políticas RLS (`USING` + `WITH CHECK`) e trigger de imutabilidade de `audit_logs`. |
| `0002_stage2_auth_rls_and_sync.sql` | FKs compostas nos relacionamentos opcionais (`search_terms`, `budgets`, `automation_runs`), coluna `action_payload_hash` em `approvals`, tabelas `member_client_access` e `sync_runs` com RLS e FKs compostas, colunas MCC em `ad_accounts`/`integrations` e restrição de privilégios por tabela para `konnexy_app`. |

---

## 4. Comandos Executados e Resultados Reais Obtidos

| Comando | Status | Resultado Real |
| :--- | :---: | :--- |
| `pnpm install --frozen-lockfile` | ✅ Passou | Lockfile sincronizado e íntegro. |
| `pnpm audit --audit-level=high` | ✅ Passou | **0 vulnerabilidades críticas, 0 vulnerabilidades altas** (Exit code 0). |
| `pnpm lint` | ✅ Passou | `eslint . --max-warnings 0` → **0 erros, 0 warnings** (Exit code 0). |
| `pnpm typecheck` | ✅ Passou | `tsc --noEmit` (TypeScript Strict) → **0 erros** (Exit code 0). |
| `pnpm test` | ✅ Passou | **40/40 testes aprovados** em 3 suítes (`architecture-and-governance.test.ts` [29], `stage2-auth-google-ads-sync.test.ts` [6] e `postgres-rls-integration.test.ts` [5] com motor PostgreSQL real `PGlite` + `PersistentDrizzleTenantRepository`). |
| `pnpm build` | ✅ Passou | `next build` (Next.js 15.5.29) → Build de produção compilado sem erros. |
| `pnpm test:e2e` | ✅ Passou | **7/7 testes Playwright aprovados** validando seletores operacionais, alternância entre tenant operacional (`Sem dados`) e tenant demonstrativo (`isDemoData: true`), Kill Switch, navegação por teclado e responsividade em `320px`, `375px`, `768px`, `1024px` e `1440px`. |

---

## 5. Limitações, Bloqueios Documentados e Próximos Passos

1. **Credenciais Oficiais Google Cloud / Google Ads Developer Token**:
   - Como variáveis reais de produção (`GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`) não são versionadas no repositório por segurança, o sistema sinaliza explicitamente o estado `BLOCKED_MISSING_CREDENTIALS` no tenant operacional e **não simula conexão falsa**. Basta injetar as variáveis reais no ambiente seguro do servidor para habilitar o redirect OAuth 2.0 real.
2. **Execução de Mutações em Campanhas Reais**:
   - Mantida estritamente bloqueada (`READ_ONLY` por padrão e bloqueio `!provider.isSimulated` no `ExecutionEngine`).
3. **Proteção da Branch `main` no GitHub**:
   - Documentada em `docs/security.md`: a branch `main` deve exigir Pull Request aprovado + status check obrigatório `Audit, Secret Scan, Lint, Typecheck, Unit, PostgreSQL RLS, Build & Playwright` antes de qualquer merge.
