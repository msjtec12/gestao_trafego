# Arquitetura de Segurança & Governança (DevSecOps & LGPD)

## 1. Modelo de Controle de Acesso (RBAC) e Escopo por Cliente

O Konnexy Ads implementa RBAC estrito por organização (`memberships.role`) com comportamento **fail-closed** (`src/security/rbac-and-tenant.ts`):

| Papel (`Role`) | Visualizar Dashboard | Gerar Análise IA | Criar/Editar Regras | Aprovar Execuções Reais | Acionar Kill Switch | Gerenciar Integrações & Billing |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `OWNER` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ADMIN` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `TRAFFIC_MANAGER` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `ANALYST` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `CLIENT_VIEWER` | ✅ (Restrito a `allowedClientIds`) | ❌ | ❌ | ❌ | ❌ | ❌ |

- **Autorização em Nível de Cliente (`assertClientScopeAccess`)**: Usuários com papel `CLIENT_VIEWER` exigem uma lista explícita `allowedClientIds` populada a partir da tabela PostgreSQL `member_client_access` e são bloqueados caso tentem acessar recursos de outro cliente da mesma organização.
- **Autenticação Operacional Persistente (Etapa 2.1)**:
  - Sessões autenticadas são persistidas na tabela `user_sessions` (com verificação de expiração e revogação imediata no logout).
  - Tentativas de login falhas são contabilizadas de forma durável na tabela PostgreSQL `auth_rate_limits` (`PersistentPostgresAuthRateLimiter`), bloqueando ataques de força bruta mesmo após reinicialização do processo.
  - O dashboard operacional (`/`) é protegido por `src/middleware.ts` e validação server-side obrigatória; o ambiente demonstrativo público fica isolado em `/demo`.

---

## 2. Isolamento Multi-Tenant em Dupla Camada (Aplicação + PostgreSQL RLS)

1. **Camada de Aplicação**:
   - `assertTenantAccess(context, resourceOrganizationId)` e `validateTenantEntityChain(context, chain)` validam o vínculo completo entre Organização → Cliente → Conta de Anúncio → Campanha → Recomendação → Aprovação.
2. **Camada de Banco de Dados (Neon PostgreSQL)**:
   - Migration `0001_multi_tenant_rls_hardening.sql` habilita `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY` com políticas `USING` e `WITH CHECK` em todas as tabelas operacionais.
   - Chaves estrangeiras compostas `(organization_id, id)` impedem em nível de constraint física que um registro da Organização A referencie uma entidade pai da Organização B.
   - A role de aplicação `konnexy_app` é configurada com `NOBYPASSRLS NOSUPERUSER` e acionada por transação via `withTenantTransaction` (`SET LOCAL ROLE konnexy_app` + `set_config('app.current_organization_id', orgId, true)`).

---

## 3. Criptografia de Credenciais OAuth (Credential Vault com Versionamento e AAD)

- O módulo `src/security/vault-and-guards.ts` utiliza **AES-256-GCM** com:
  - **Validação de Entropia**: Rejeita chaves zeradas ou de baixa entropia.
  - **Versionamento de Chaves (`v1`, `v2`, ...)**: Formato `version:ivHex:authTagHex:cipherHex`, permitindo rotação de chaves sem indisponibilidade.
  - **Additional Authenticated Data (AAD)**: Vincula criptograficamente o ciphertext ao par `org:<organizationId>|integration:<integrationId>`, impedindo que um token criptografado seja copiado para outra organização ou integração.

---

## 4. Proteções de Aplicação, SSRF, CSP e Governança de Repositório

- **Validação de Ambiente com Zod (`src/security/env.ts`)**: `ServerEnvSchema` rejeita inicialização em `NODE_ENV=production` caso detecte secrets demonstrativos (`replace_with_*` ou chaves de baixa entropia).
- **Proteção contra SSRF e DNS Rebinding**: `resolveAndValidateSafeExternalUrl` exige `https://`, bloqueia credenciais na URL, valida a resolução DNS (`dns.lookup`) contra faixas IPv4/IPv6 privadas, loopback, link-local (`169.254.0.0/16`), CGNAT (`100.64.0.0/10`) e desativa redirecionamentos automáticos (`redirect: "error"`).
- **Content Security Policy (CSP)**: Configurada em `next.config.ts` junto a `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` e `Cross-Origin-Opener-Policy: same-origin`.
- **Regras Recomendadas para Proteção da Branch `main` no GitHub**:
  - Exigir Pull Request com pelo menos 1 aprovação antes do merge.
  - Exigir aprovação do status check obrigatório `Audit, Secret Scan, Lint, Typecheck, Unit, PostgreSQL RLS, Build & Playwright` (`.github/workflows/ci.yml`).
  - Bloquear force-pushes e exclusão da branch `main`.
