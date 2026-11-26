# Arquitetura de Segurança & Governança (DevSecOps & LGPD)

## 1. Modelo de Controle de Acesso (RBAC)

O Konnexy Ads implementa RBAC estrito por organização (`memberships.role`):

| Papel (`Role`) | Visualizar Dashboard | Gerar Análise IA | Criar/Editar Regras | Aprovar Execuções Reais | Acionar Kill Switch | Gerenciar Integrações & Billing |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `OWNER` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ADMIN` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `TRAFFIC_MANAGER` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `ANALYST` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `CLIENT_VIEWER` | ✅ (Somente Cliente) | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 2. Isolamento Multi-Tenant

1. Todo acesso a dados passa pelo guarda `assertTenantAccess(sessionTenantId, targetOrganizationId)`.
2. Caso um usuário autenticado na Organização A tente consultar ou modificar um recurso pertencente à Organização B, o sistema lança `TenantIsolationError` (HTTP 403) e registra um evento de segurança no `AuditEngine`.

---

## 3. Criptografia de Credenciais OAuth (Credential Vault)

- Tokens OAuth (`access_token`, `refresh_token`) nunca são armazenados em texto puro.
- O módulo `src/security/encryption.ts` utiliza **AES-256-GCM** (Node.js `crypto`) com chave de 256 bits (`CREDENTIALS_ENCRYPTION_KEY`), IV aleatório de 12 bytes por operação e Auth Tag de 16 bytes para garantir confidencialidade e integridade autenticada.

---

## 4. Proteções de Aplicação e Infraestrutura

- **Validação Server-Side**: Todos os payloads passam por schemas `Zod` no servidor.
- **Proteção contra Prompt Injection**: Dados vindos de APIs externas (títulos de anúncios, termos de pesquisa, URLs de landing pages) são sanitizados e delimitados como dados não confiáveis antes de serem enviados aos analisadores de IA; modelos de IA não possuem permissão de invocação direta de métodos de mutação (`ExecutionEngine`).
- **Proteção contra SSRF**: O `LandingPageAuditor` valida URLs contra IPs privados (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254` metadata endpoints) e exige protocolo `https://`.
- **Bloqueio de Produtos/Serviços Restritos**: O `PolicyEngine` bloqueia automaticamente campanhas ou criativos contendo termos associados a categorias ilegais ou restritas pelas políticas do Google Ads e Meta Ads (armas, drogas ilícitas, jogos de azar não licenciados, promessas médicas enganosas, etc.).
- **Logs Sem Informações Sensíveis**: O utilitário `redactSensitiveData` mascara automaticamente chaves como `accessToken`, `refreshToken`, `clientSecret`, `password`, `authorization` e `apiKey`.
- **PWA Seguro**: O Service Worker / Web Manifest não faz cache offline de respostas de APIs ou dados sensíveis de clientes (`Cache-Control: no-store`).
