# ADR 0003: Governança do Motor de Automações, IA Supervisionada e Kill Switch

- **Status**: Aceito
- **Data**: 2026-11-26
- **Decisores**: AI Engineer, DevSecOps Engineer & Traffic Domain Specialist

## Contexto
Alterações automatizadas ou geradas por IA em contas de Google Ads e Meta Ads possuem risco financeiro direto (estouro de orçamento, pausa indevida de campanhas lucrativas ou violação de políticas de anúncios).

## Decisão
1. **Modo Padrão `READ_ONLY`**: Nenhuma organização recém-criada ou em modo padrão executa mutações externas.
2. **Desacoplamento Total entre IA e Execução**: Modelos de IA não possuem tools de escrita em provedores de anúncios. Toda saída de IA é validada via `Zod` e persistida apenas como `Recommendation`.
3. **Pipeline de 9 Etapas + 7 Motores**: Toda ação passa obrigatoriamente por Coleta, Normalização, Análise, Recomendação, Validação (`PolicyEngine` + `RiskEngine`), Aprovação Humana (`ApprovalEngine`), Execução Idempotente com Cooldown (`ExecutionEngine`), Verificação e Auditoria (`AuditEngine`).
4. **Emergency Kill Switch**: Um botão de emergência suspende instantaneamente todas as automações e bloqueia o `ExecutionEngine`.

## Consequências
- **Positivas**: Elimina o risco de alucinações de LLM alterarem campanhas reais sem supervisão humana, garante idempotência e oferece rastreabilidade completa.
- **Negativas**: Aumenta um passo de confirmação para o gestor de tráfego nas ações de risco médio/alto, o que é intencional para segurança B2B.
