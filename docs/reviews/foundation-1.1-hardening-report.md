# Relatório Técnico de Auditoria e Hardening — Foundation 1.1

- **Projeto**: Konnexy Ads (`ads.konnexy.com.br`)
- **Repositório**: `https://github.com/msjtec12/gestao_trafego`
- **Branch de Referência**: `feat/foundation-stage-1`
- **Commit Auditado**: `63b3c17ba84442a1d80a00ca0e2e284fa1ababc7`
- **Branch de Trabalho**: `fix/foundation-security-hardening`
- **Data da Execução**: 2026-11-26

---

## 1. Resumo Executivo

Este relatório documenta o tratamento completo dos **32 apontamentos técnicos** levantados na auditoria externa da entrega Foundation 1.0, abrangendo segurança da cadeia de suprimentos (dependências), isolamento multi-tenant físico e lógico no PostgreSQL (RLS + chaves estrangeiras compostas), criptografia autenticada com versionamento de chaves e AAD, proteção SSRF com validação DNS, governança dos 7 motores de automação com máquina de estados explícita, refatoração acessível do Dashboard e pipeline CI/CD bloqueante com testes reais em banco PostgreSQL descartável e Playwright E2E.

---

## 2. Problemas Corrigidos por Fase

### Fase A — Segurança das Dependências (Bloqueadora)
1. **69 vulnerabilidades no `pnpm audit` (10 críticas, 23 altas, 31 moderadas, 5 baixas)**:
   - **Causa raiz**: `next@15.2.1`, `next-auth@5.0.0-beta.25`, `drizzle-orm@0.40.1`, `zod@3.25.76`, `ai@4.3.19`, `@ai-sdk/openai@1.3.24` (que dependia transitivamente de `undici@5.29.0`) e `vitest@3.2.7` (que dependia de `tinypool@1.1.1`).
   - **Correção**: Atualização controlada para `next@15.5.29`, `eslint-config-next@15.5.29`, `next-auth@5.0.0-beta.32`, `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `zod@4.6.7`, `ai@6.0.338`, `@ai-sdk/openai@3.0.147`, `@neondatabase/serverless@1.2.1`, `vitest@4.1.12` e override cirúrgico `next@15.5.29>postcss: ^8.5.23`.
   - **Resultado**: **0 críticas, 0 altas, 0 baixas**. `pnpm audit --audit-level=high` retorna exit code `0`.
2. **Pipeline CI ignorando falhas de auditoria (`|| true`)**:
   - **Correção**: Removido `|| true` em `.github/workflows/ci.yml`. Qualquer vulnerabilidade alta ou crítica agora bloqueia o pipeline.
3. **Avaliação do Auth.js v5 Beta**:
   - **Decisão**: Mantido na linha v5 (`5.0.0-beta.32`) por compatibilidade nativa com Next.js 15 App Router e corrigindo todos os advisories de `beta.25`. Sua ativação permanece isolada para a Etapa 2 sem simular autenticação falsa na Foundation 1.1.

### Fase B — PostgreSQL e Isolamento Multi-Tenant
4. **Ausência de políticas RLS nas migrations aplicadas**:
   - **Correção**: Criada a migration incremental `drizzle/migrations/0001_multi_tenant_rls_hardening.sql` com `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY` e políticas `USING` + `WITH CHECK` em todas as tabelas operacionais.
5. **Chaves estrangeiras simples permitindo relacionamento cruzado entre organizações**:
   - **Correção**: Adicionados índices únicos compostos `(organization_id, id)` e FKs compostas (`ad_accounts_org_client_fk`, `ad_accounts_org_integration_fk`, `campaigns_org_ad_account_fk`, `ad_groups_org_campaign_fk`, `ads_org_ad_group_fk`, `keywords_org_ad_group_fk`, `search_terms_org_campaign_fk`, `daily_metrics_org_campaign_fk`, `conversions_org_ad_account_fk`, `budgets_org_client_fk`, `recommendations_org_campaign_fk`, `automation_runs_org_rule_fk`, `approvals_org_recommendation_fk`, `execution_jobs_org_approval_fk`, `execution_jobs_org_campaign_fk`, `reports_org_client_fk`).
6. **Chave de idempotência global sem escopo de organização**:
   - **Correção**: Índice único alterado para composto `(organization_id, idempotency_key)` (`execution_jobs_org_idempotency_idx`).
7. **Ausência de role PostgreSQL de menor privilégio sem `BYPASSRLS`**:
   - **Correção**: Criada a role `konnexy_app` (`NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE`) e wrapper transacional `withTenantTransaction` com `SET LOCAL ROLE konnexy_app` e `set_config('app.current_organization_id', orgId, true)`.
8. **Proteção e retenção de `audit_logs`**:
   - **Correção**: Adicionada coluna `retention_until`, alterada FK de `organization_id` para `ON DELETE RESTRICT`, revogados `UPDATE` e `DELETE` da role `konnexy_app` e criado o trigger `trg_protect_audit_logs`.
9. **Validação da cadeia de vínculos e repositórios tenant-scoped**:
   - **Correção**: Implementados `TenantScopedRepository` e `validateTenantEntityChain` em `src/infrastructure/db/repositories/tenant-repository.ts`.

### Fase C — Segurança da Aplicação
10. **Validação de variáveis de ambiente e rejeição de secrets demonstrativos**:
    - **Correção**: Implementado `ServerEnvSchema` em `src/security/env.ts`, rejeitando secrets placeholder (`replace_with_*`) ou de baixa entropia em produção.
11. **Chave AES-256-GCM sem validação de entropia, sem versionamento e sem AAD**:
    - **Correção**: `encryptCredential` e `decryptCredential` em `src/security/vault-and-guards.ts` agora validam entropia da chave hexadecimal, suportam `KeyRing` versionado (`v1:iv:tag:ciphertext`) e vinculam `CredentialAadContext` (`organizationId` + `integrationId`) via `cipher.setAAD`.
12. **Proteção SSRF apenas sintática**:
    - **Correção**: Implementado `resolveAndValidateSafeExternalUrl` com resolução DNS (`dns.lookup`), bloqueio de IPv4/IPv6 privados, loopback, link-local, CGNAT, proteção contra DNS rebinding e `redirect: "error"`.
13. **Sanitização de logs vulnerável a referências circulares e tokens inline**:
    - **Correção**: `redactSensitiveData` agora utiliza `WeakSet` para referências circulares (`[CIRCULAR_REF]`) e mascara tokens inline (`Bearer ...`, `sk-...`, `ya29....`).
14. **RBAC desalinhado com a documentação e sem autorização por cliente**:
    - **Correção**: Alinhado `ADMIN` na matriz de permissões, implementado comportamento fail-closed e criado `assertClientScopeAccess` para restringir `CLIENT_VIEWER` aos clientes em `allowedClientIds`.
15. **Headers de segurança e CSP**:
    - **Correção**: Adicionados `Content-Security-Policy` e `Cross-Origin-Opener-Policy` em `next.config.ts`.

### Fase D & E — Governança do Motor de Automação e Qualidade TypeScript
16. **Regras desativadas sendo avaliadas**:
    - **Correção**: `RuleEngine.evaluateCampaign` verifica `!rule.isEnabled` no primeiro passo e retorna `matched: false`.
17. **Janela temporal configurável usando métricas fixas de 7 dias**:
    - **Correção**: `RuleEngine` agora resolve `metricsByWindowDays[rule.timeWindowDays]` (suportando janelas como 3d, 7d, 14d, 30d).
18. **Validação insuficiente de parâmetros financeiros**:
    - **Correção**: `PolicyEngine.validateFinancialLimit` valida `Number.isFinite`, rejeita reduções `<= -100%` e valida orçamentos positivos via schemas Zod (`DiscriminatedMutationActionSchema`).
19. **Aprovação representada apenas por `boolean`**:
    - **Correção**: Implementado `ApprovalEngine` e `ApprovalRecord` estruturado com verificação de expiração, campanha, tipo de ação, tenant e permissão RBAC do aprovador.
20. **Idempotência concorrente, Circuit Breaker, Kill Switch Global e Auditoria**:
    - **Correção**: Extraídos contratos injetáveis `IdempotencyStore` (com lock atômico `IN_FLIGHT` / `COMPLETED`), `CircuitBreakerStore`, `KillSwitchStore` (global + organizacional) e `AuditLogStore`.
21. **Verificação independente pós-execução e Máquina de Estados**:
    - **Correção**: Implementados `provider.verifyMutation` e `RecommendationStateMachine`.
22. **Separação de contratos de leitura/execução e camada Application**:
    - **Correção**: Separados `AdvertisingReadProvider` e `AdvertisingExecutionProvider` e criado `getDashboardOverviewUseCase` em `src/application/use-cases/dashboard-overview-use-case.ts`.

### Fase F, G & H — UI/UX, Acessibilidade, Testes Reais e CI/CD
23. **Refatoração modular do `dashboard-shell.tsx` e transparência do Kill Switch**:
    - **Correção**: Extraídos `AppSidebar`, `DashboardHeader`, `MobileNavigation`, `DashboardOverview`, `EmergencyStopControl` e `DemoModeBanner`. O Kill Switch da UI agora indica explicitamente tratar-se de simulação local.
24. **Testes reais em PostgreSQL descartável e Playwright Multi-Viewport**:
    - **Correção**: Adicionados `src/tests/postgres-rls-integration.test.ts` (4 testes SQL reais no `PGlite`) e `e2e/dashboard.spec.ts` (7 testes E2E cobrindo teclado e viewports `320px`, `375px`, `768px`, `1024px`, `1440px`).

---

## 3. Problemas Remanescentes / Vulnerabilidades Transitivas Documentadas

| Pacote | Severidade | Caminho Transitivo | Impacto em Runtime | Mitigação |
| :--- | :---: | :--- | :--- | :--- |
| `esbuild@0.18.20` | Moderada (1) | `drizzle-kit@0.31.11 > @esbuild-kit/esm-loader > esbuild` | **Nenhum impacto em produção**. `drizzle-kit` é exclusivamente uma ferramenta de linha de comando de desenvolvimento para geração local de arquivos SQL (`pnpm db:generate`). | Nunca é empacotada no build do Next.js nem executa como servidor HTTP exposto. O bloqueador de CI verifica `--audit-level=high` (0 altas, 0 críticas). |

---

## 4. Comandos Executados e Resultados Reais

| Comando | Resultado | Detalhes |
| :--- | :---: | :--- |
| `pnpm install --frozen-lockfile` | ✅ Passou | Lockfile `pnpm-lock.yaml` íntegro e sincronizado. |
| `pnpm audit --audit-level=high` | ✅ Passou | Exit code `0` (**0 críticas, 0 altas**). |
| `pnpm lint` | ✅ Passou | `eslint . --max-warnings 0` → 0 erros, 0 warnings. |
| `pnpm typecheck` | ✅ Passou | `tsc --noEmit` (Strict Mode completo) → 0 erros. |
| `pnpm test` | ✅ Passou | **33/33 testes aprovados** (29 testes unitários/arquitetura + 4 testes de integração SQL reais no PostgreSQL descartável `PGlite`). |
| `pnpm build` | ✅ Passou | Build de produção do Next.js 15.5.29 concluído com sucesso. |
| `pnpm test:e2e` | ✅ Passou | **7/7 testes Playwright aprovados** (Banner Demo, Kill Switch Simulado, Teclado `Ctrl+K`/`Escape` e 5 viewports de `320px` a `1440px`). |

---

## 5. Checklist para a Próxima Revisão (Etapa 2)

- [x] Zero vulnerabilidades críticas ou altas no `pnpm audit`.
- [x] Políticas PostgreSQL RLS (`USING` + `WITH CHECK`) e FKs compostas `(organization_id, id)` testadas em motor PostgreSQL real.
- [x] 7 Motores de Automação separados com Máquina de Estados e `ApprovalRecord` estruturado.
- [x] Dashboard modularizado, acessível e com identificação explícita de dados demonstrativos e Kill Switch simulado.
- [x] Pipeline CI/CD completa com verificação de secrets, auditoria bloqueante, testes PostgreSQL RLS e Playwright.
