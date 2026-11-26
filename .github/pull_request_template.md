## Descrição da Entrega

Descreva de forma clara e objetiva o propósito deste Pull Request, qual etapa do roadmap ou módulo ele contempla e o problema resolvido.

---

## Mudanças Realizadas

- [ ] Nova funcionalidade / Módulo
- [ ] Correção de bug
- [ ] Refatoração arquitetural
- [ ] Migração de banco de dados (Drizzle)
- [ ] Documentação / ADR
- [ ] Testes automatizados / CI

---

## Decisões Arquiteturais

Liste as principais decisões técnicas tomadas nesta branch (e referencie o ADR correspondente em `docs/adr/`, se aplicável):

-

---

## Checklist de Segurança e Multi-Tenancy

- [ ] Todas as queries e mutações validam `organization_id` no servidor.
- [ ] Nenhum segredo, token ou chave privada foi versionado.
- [ ] Modelos de IA não executam mutações diretas em contas de anúncio.
- [ ] O modo padrão permanece `READ_ONLY` sem execução automática não autorizada.
- [ ] Dados demonstrativos (`MockAdsProvider`) estão claramente identificados.
- [ ] Nenhuma migration destrutiva é executada automaticamente.

---

## Verificação de Qualidade (Resultados Reais)

- [ ] `pnpm lint` (0 erros, 0 warnings)
- [ ] `pnpm typecheck` (TypeScript Strict OK)
- [ ] `pnpm test` (Vitest 100% passando)
- [ ] `pnpm build` (Next.js Production Build OK)

---

## Limitações, Riscos e Instruções de Reprodução

1. **Como testar localmente**:
   ```bash
   pnpm install
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   pnpm dev
   ```
2. **Limitações conhecidas / Próximos passos**:
   -
