# Política de Segurança (SECURITY.md)

## 1. Versões Suportadas

| Versão | Suportada | Status |
| :--- | :--- | :--- |
| `0.1.x` | Sim | Foundation Release |

## 2. Princípios de Segurança do Konnexy Ads

1. **Zero Trust Multi-Tenant**:
   - Toda requisição autenticada resolve um `TenantContext` contendo `organizationId`, `userId` e `role`.
   - Acesso cruzado entre organizações é bloqueado na camada de aplicação (`assertTenantAccess`) e no banco de dados (Row-Level Security no Neon PostgreSQL).
2. **Proteção de Credenciais OAuth & Tokens**:
   - Access tokens e refresh tokens de provedores de anúncio (Google Ads, Meta Ads, Microsoft Ads) são criptografados em repouso utilizando **AES-256-GCM** com IV único e Authentication Tag antes de serem persistidos na tabela `integrations`.
   - Nenhuma credencial sensível é retornada para o cliente ou registrada em logs (`redactSensitiveData`).
3. **Governança de IA e Automação**:
   - O sistema inicia por padrão em modo **`READ_ONLY`**.
   - Modelos de IA (LLMs) não possuem acesso direto a ferramentas de mutação de campanhas; toda recomendação exige validação de schema (`Zod`), verificação de políticas de risco e aprovação humana explícita (`Approvals`).
   - Botão de Emergência (**Kill Switch**) disponível globalmente para suspender todas as automações ativas.
4. **Conformidade com LGPD (Lei nº 13.709/2018)**:
   - Minimização de dados pessoais coletados.
   - Trilha de auditoria imutável (`audit_logs`) para rastreabilidade de acessos e alterações.
   - Suporte a revogação imediata de tokens OAuth e exclusão lógica/física de dados de titulares mediante solicitação.

## 3. Como Reportar uma Vulnerabilidade

Caso identifique qualquer vulnerabilidade de segurança:
1. **Não abra uma issue pública no GitHub.**
2. Envie um relatório detalhado para `security@konnexy.com.br` contendo:
   - Descrição da vulnerabilidade e vetor de ataque.
   - Passos para reprodução (PoC).
   - Impacto estimado.
3. Nossa equipe responderá em até **24 horas úteis** com o plano de mitigação e correção.
