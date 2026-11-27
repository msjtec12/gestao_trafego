# Konnexy Ads — Atualização Google Ads API (Política Oficial de 09/09/2026)

**Branch:** `feat/google-ads-2026-cloud-project-auth`
**Referência Oficial:** https://developers.google.com/google-ads/api/docs/api-policy/developer-token
**Modo Operacional:** `READ_ONLY` (OAuth 2.0 + PKCE + Credential Vault AES-256-GCM + RLS preservados).

---

## 1. Mudanças Oficiais Aplicadas

A partir de **9 de setembro de 2026**, o Google descontinuou o `developer-token` como mecanismo obrigatório de autorização e nível de acesso na Google Ads API, vinculando a autorização diretamente ao **Projeto Google Cloud** (gerenciado em *Google Cloud Console → Google Ads API Overview*).

| Requisito | Implementação |
|---|---|
| **Remover obrigatoriedade de `GOOGLE_ADS_DEVELOPER_TOKEN`** | `buildGoogleAdsReadOnlyHeaders`, `getGoogleAdsOAuthConfigurationStatus` e `requireGoogleAdsOAuthConfig` não exigem mais `GOOGLE_ADS_DEVELOPER_TOKEN`; o header `developer-token` é omitido automaticamente quando ausente ou placeholder. |
| **Chamadas REST vinculadas ao Projeto Google Cloud** | `listAccessibleCustomersViaRest` e `executeReadOnlyGaqlSearchViaRest` operam via `Authorization: Bearer <accessToken>` + `login-customer-id` (MCC opcional), preservando OAuth 2.0, PKCE, SSRF Pinning, Credential Vault e RLS. |
| **Manter `GOOGLE_ADS_CLIENT_ID` e `GOOGLE_ADS_CLIENT_SECRET` obrigatórios** | `requireGoogleAdsOAuthConfig` continua falhando fechado (`MissingOrWeakSecretError`) quando ausentes ou com placeholder. |
| **Validar URL de callback oficial** | `validateOfficialGoogleAdsCallbackUrl` exige caminho exato `/api/integrations/google-ads/callback` e protocolo `https://` em produção/Vercel (`https://ads.konnexy.com.br/api/integrations/google-ads/callback`). |
| **Tratar `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`** | `GoogleAdsCloudProjectApprovalError` e `isCloudProjectNotApprovedForProductionError` detectam o erro oficial do Google Ads API quando o projeto Google Cloud possui apenas Acesso de Teste e retornam orientação clara em pt-BR. |
| **Substituir respostas JSON brutas por mensagens amigáveis** | `/api/integrations/google-ads/authorize` e `/api/integrations/google-ads/callback` redirecionam navegações de navegador (`Accept: text/html`) de volta à interface com banner amigável de sucesso/erro (mantendo HTTP 401/JSON para chamadas de API sem autenticação). |
| **Exibir status real da configuração na UI** | `DashboardShell` e `TenantManagementHub` exibem o painel `Status da Configuração Google Ads (Política Oficial 09/09/2026)` com status real das variáveis obrigatórias e URL de callback oficial. |
| **Atualizar `.env.example`** | Removida a variável obrigatória `GOOGLE_ADS_DEVELOPER_TOKEN` e documentada a autorização via Projeto Google Cloud + URL de callback oficial. |

---

## 2. Banco de Dados e Credenciais Existentes
- **Nenhuma alteração** foi feita no banco Neon PostgreSQL ou nas credenciais existentes.
- Modo **`READ_ONLY`** 100% preservado.
