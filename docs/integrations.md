# Arquitetura de Integrações — AdvertisingProvider

## 1. Contrato Independente de Fornecedor

Para evitar acoplamento com SDKs externos, o domínio do Konnexy Ads se comunica exclusivamente através da interface `AdvertisingProvider` (`src/integrations/contracts/advertising-provider.ts`):

```typescript
export interface AdvertisingProvider {
  readonly providerType: AdProviderType;
  readonly isSimulated: boolean;
  validateCredentials(accountId: string): Promise<ProviderHealthStatus>;
  listCampaigns(params: ListCampaignsParams): Promise<PaginatedResult<NormalizedCampaign>>;
  getDailyMetrics(params: GetMetricsParams): Promise<NormalizedDailyMetric[]>;
  simulateMutation(mutation: CampaignMutationRequest): Promise<MutationSimulationResult>;
  executeMutation(mutation: ApprovedCampaignMutation): Promise<MutationExecutionResult>;
}
```

---

## 2. Provedores Previstos

1. **`MockAdsProvider` (Prioridade 1 — Foundation & Testes)**:
   - Retorna dados determinísticos e realistas de campanhas locais e e-commerce.
   - Todo payload retornado inclui `isDemoData: true` e `providerType: "MOCK_ADS"`.
   - Permite simular falhas de rede, rate limits (`429 Too Many Requests`), expiração de token (`401 Unauthorized`) e timeouts para validar a resiliência do motor de automação.
2. **`GoogleAdsProvider` (Prioridade 1 — Produção)**:
   - Integração via Google Ads REST API oficial (GAQL — Google Ads Query Language).
   - Suporte a OAuth 2.0 com renovação automática de `refresh_token`, cabeçalhos `developer-token` e `login-customer-id` (MCC).
   - Mapeamento de erros específicos (`QuotaError`, `AuthenticationError`, `PolicyViolationError`).
3. **`MetaAdsProvider` (Fase 2)**:
   - Integração com Meta Marketing API (Graph API), System User Tokens e Insights API.
4. **`MicrosoftAdsProvider` (Fase 3)**:
   - Integração com Microsoft Advertising API (Bing Ads).

---

## 3. Resiliência e Governança de Chamadas

- **Rate Limiting & Retries**: Backoff exponencial com full jitter apenas para erros transitórios (`429`, `502`, `503`, `504`). Erros de validação ou permissão (`400`, `401`, `403`) falham imediatamente sem retry.
- **Timeouts Estritos**: AbortController configurável (padrão `15000ms` para leitura, `10000ms` para mutação).
- **Idempotência**: Mutações enviadas ao provedor exigem um `idempotencyKey` único gerado pelo `ApprovalEngine` / `ExecutionEngine`.
