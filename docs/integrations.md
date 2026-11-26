# Arquitetura de Integrações — AdvertisingProvider

## 1. Separação entre Contratos de Leitura e Execução

Para garantir o princípio de menor privilégio e impedir que fluxos analíticos ou de IA tenham acesso a métodos de mutação, o Konnexy Ads separa as interfaces em `src/integrations/contracts/advertising-provider.ts`:

```typescript
export interface AdvertisingReadProvider {
  readonly providerType: AdProviderType;
  readonly isSimulated: boolean;
  checkHealth(organizationId: string): Promise<ProviderHealthStatus>;
  listCampaigns(organizationId: string): Promise<NormalizedCampaign[]>;
  getDailyMetrics(organizationId: string): Promise<NormalizedDailyMetric[]>;
}

export interface AdvertisingExecutionProvider {
  readonly providerType: AdProviderType;
  readonly isSimulated: boolean;
  simulateMutation(request: CampaignMutationRequest): Promise<MutationSimulationResult>;
  executeMutation(request: CampaignMutationRequest): Promise<MutationExecutionResult>;
  verifyMutation?(
    request: CampaignMutationRequest,
    executionResult: MutationExecutionResult
  ): Promise<PostExecutionVerificationResult>;
}

export interface AdvertisingProvider
  extends AdvertisingReadProvider,
    AdvertisingExecutionProvider {}
```

---

## 2. Discriminated Unions e Validação Zod de Mutações

Todas as ações de mutação são validadas pelo schema `DiscriminatedMutationActionSchema`:
- `PAUSE_CAMPAIGN`: Exige `reason` descritiva (`PauseCampaignPayloadSchema`).
- `ADJUST_DAILY_BUDGET`: Exige `proposedDailyBudgetBrl` finito e positivo e valida `changePct` finito dentro de `±100%` (`AdjustDailyBudgetPayloadSchema`).
- `ADD_NEGATIVE_KEYWORD`: Exige lista não vazia de `negativeKeywords` e `matchType` (`EXACT`, `PHRASE`, `BROAD`).
- `ADJUST_TARGET_CPA`: Exige `proposedTargetCpaBrl` finito e positivo.

---

## 3. Provedores Previstos

1. **`MockAdsProvider` (Ativo na Foundation 1.1)**:
   - Retorna dados determinísticos com `isDemoData: true`, incluindo métricas por janela temporal (`metricsByWindowDays` para 3d, 7d, 14d e 30d).
   - Implementa `verifyMutation` para reconciliação independente pós-execução e suporta simulação de falhas (`RATE_LIMIT_EXCEEDED`, `AUTH_TOKEN_REVOKED`, `PROVIDER_TIMEOUT`, `VERIFICATION_MISMATCH`).
2. **`GoogleAdsProvider` (Bloqueado por Segurança na Foundation 1.1)**:
   - Possui `isSimulated = false`. O `ExecutionEngine` bloqueia automaticamente qualquer tentativa de execução em provedores com `isSimulated === false` durante a etapa Foundation (`NON_SIMULATED_PROVIDER_BLOCKED`).
3. **`MetaAdsProvider` & `MicrosoftAdsProvider` (Fases 3 e 4)**.
