# ADR 0001: Arquitetura de Monólito Modular com Clean Architecture

- **Status**: Aceito
- **Data**: 2026-11-26
- **Decisores**: Equipe Sênior de Engenharia Konnexy Ads

## Contexto
O Konnexy Ads precisa atender negócios locais e agências de tráfego com alta confiabilidade, segurança multi-tenant, integrações com APIs complexas (Google Ads, Meta Ads) e automação supervisionada por IA. Microsserviços distribuídos logo no início introduziriam latência de rede, sobrecarga operacional e complexidade transacional desnecessária.

## Decisão
Adotamos um **Monólito Modular** em TypeScript Strict sobre Next.js App Router, organizando o código em camadas concêntricas de **Clean Architecture** (`domain`, `application`, `infrastructure`, `integrations`, `security`, `automation`, `workflows`) e módulos verticais em `src/modules/`.

## Consequências
- **Positivas**: Transações ACID simples no Neon PostgreSQL, tipagem compartilhada sem publicação de pacotes internos, deploy atômico na Vercel e fronteiras claras que impedem acoplamento com fornecedores externos.
- **Negativas**: Exige disciplina rigorosa nos imports e revisões de PR para evitar dependências circulares entre módulos.
