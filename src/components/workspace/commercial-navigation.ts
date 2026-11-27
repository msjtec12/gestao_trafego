export interface CommercialNavItem {
  readonly id: string;
  readonly href: string;
  readonly label: string;
  readonly group: "OPERACAO" | "INTELIGENCIA" | "PLATAFORMA";
}

/**
 * Commercial navigation for traffic managers (15 dedicated routes).
 * Zero engineering jargon in primary navigation; architecture & security
 * diagnostics live inside `/configuracoes` restricted to OWNER/ADMIN.
 */
export const COMMERCIAL_NAV_ITEMS: readonly CommercialNavItem[] = [
  // Operação
  { id: "visao-geral", href: "/", label: "Visão Geral", group: "OPERACAO" },
  { id: "clientes", href: "/clientes", label: "Clientes", group: "OPERACAO" },
  { id: "campanhas", href: "/campanhas", label: "Campanhas", group: "OPERACAO" },
  {
    id: "grupos-de-anuncios",
    href: "/grupos-de-anuncios",
    label: "Grupos de Anúncios",
    group: "OPERACAO",
  },
  { id: "anuncios", href: "/anuncios", label: "Anúncios", group: "OPERACAO" },
  {
    id: "palavras-chave",
    href: "/palavras-chave",
    label: "Palavras-chave",
    group: "OPERACAO",
  },
  {
    id: "termos-de-pesquisa",
    href: "/termos-de-pesquisa",
    label: "Termos de Pesquisa",
    group: "OPERACAO",
  },
  {
    id: "conversoes",
    href: "/conversoes",
    label: "Conversões",
    group: "OPERACAO",
  },
  {
    id: "orcamentos",
    href: "/orcamentos",
    label: "Orçamentos",
    group: "OPERACAO",
  },
  // Inteligência
  {
    id: "ia",
    href: "/ia",
    label: "Central de IA",
    group: "INTELIGENCIA",
  },
  {
    id: "recomendacoes",
    href: "/recomendacoes",
    label: "Recomendações",
    group: "INTELIGENCIA",
  },
  {
    id: "automacoes",
    href: "/automacoes",
    label: "Automações",
    group: "INTELIGENCIA",
  },
  {
    id: "relatorios",
    href: "/relatorios",
    label: "Relatórios",
    group: "INTELIGENCIA",
  },
  // Plataforma
  {
    id: "integracoes",
    href: "/integracoes",
    label: "Integrações",
    group: "PLATAFORMA",
  },
  {
    id: "configuracoes",
    href: "/configuracoes",
    label: "Configurações",
    group: "PLATAFORMA",
  },
];

export const COMMERCIAL_NAV_GROUPS: readonly {
  readonly key: CommercialNavItem["group"];
  readonly label: string;
}[] = [
  { key: "OPERACAO", label: "Operação" },
  { key: "INTELIGENCIA", label: "Inteligência & Otimização" },
  { key: "PLATAFORMA", label: "Plataforma" },
];
