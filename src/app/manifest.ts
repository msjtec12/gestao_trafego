import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Konnexy Ads — Inteligência & Automação Supervisionada",
    short_name: "Konnexy Ads",
    description:
      "Plataforma SaaS B2B para gerenciamento centralizado, análise inteligente e automação supervisionada de tráfego pago.",
    start_url: "/",
    display: "standalone",
    background_color: "#060d1a",
    theme_color: "#06b6d4",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
