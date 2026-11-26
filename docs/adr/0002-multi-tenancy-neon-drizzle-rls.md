# ADR 0002: Neon PostgreSQL, Drizzle ORM e Isolamento Multi-Tenant com `organization_id`

- **Status**: Aceito
- **Data**: 2026-11-26
- **Decisores**: Database Engineer & Principal Software Architect

## Contexto
Por requisito de arquitetura e governança, o Supabase não deve ser utilizado. O sistema exige um banco PostgreSQL serverless de alta performance, suporte a branching para ambientes de PR, controle fino de queries SQL e isolamento multi-tenant rigoroso entre agências e clientes.

## Decisão
1. Utilizar **Neon PostgreSQL** (`@neondatabase/serverless`) como banco oficial.
2. Utilizar **Drizzle ORM** e **Drizzle Kit** para schemas fortemente tipados em TypeScript e migrations versionadas em SQL puro (`drizzle/migrations`), proibindo migrations destrutivas automáticas.
3. Incluir `organization_id` (`UUID NOT NULL`) em todas as tabelas operacionais e aplicar dupla barreira de segurança: validação obrigatória no servidor (`assertTenantAccess`) + políticas de Row-Level Security (RLS) no PostgreSQL.

## Consequências
- **Positivas**: Zero overhead de runtime ORM pesado, queries SQL transparentes, compatibilidade total com Edge/Serverless na Vercel e blindagem contra vazamento de dados entre organizações.
- **Negativas**: Toda nova tabela operacional precisa obrigatoriamente definir chave estrangeira e índice composto iniciando por `organization_id`.
