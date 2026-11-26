"use client";

import * as React from "react";
import {
  Search,
  LayoutDashboard,
  Megaphone,
  Sparkles,
  ShieldAlert,
  Cpu,
  FileText,
  X,
} from "lucide-react";

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelectSection: (sectionId: string) => void;
  readonly onTriggerKillSwitch: () => void;
}

const COMMAND_ITEMS = [
  {
    id: "overview",
    label: "Ir para Visão Geral & KPIs",
    category: "Navegação",
    icon: LayoutDashboard,
  },
  {
    id: "campaigns",
    label: "Inspecionar Tabela de Campanhas (TanStack Table)",
    category: "Campanhas",
    icon: Megaphone,
  },
  {
    id: "ai-recommendations",
    label: "Abrir Centro de Recomendações IA Supervisionada",
    category: "Inteligência Artificial",
    icon: Sparkles,
  },
  {
    id: "automation-engine",
    label: "Ver Motor de Automações & Trilha de Auditoria",
    category: "Governança",
    icon: Cpu,
  },
  {
    id: "architecture-docs",
    label: "Inspecionar Status Multi-Tenant & 22 Domínios Drizzle",
    category: "Arquitetura",
    icon: FileText,
  },
];

export function CommandPalette({
  open,
  onOpenChange,
  onSelectSection,
  onTriggerKillSwitch,
}: CommandPaletteProps) {
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
      if (event.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  const filtered = COMMAND_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      item.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/75 backdrop-blur-sm pt-24 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette Konnexy Ads"
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-700/80 bg-[#0b1629] text-slate-100 shadow-2xl overflow-hidden">
        <div className="flex items-center border-b border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 text-cyan-400 mr-3 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar comandos, campanhas, módulos ou ações de governança..."
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-slate-400 hover:text-slate-200 p-1"
            aria-label="Fechar Command Palette"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Nenhum comando encontrado para &ldquo;{query}&rdquo;.
            </div>
          ) : (
            filtered.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectSection(item.id);
                    onOpenChange(false);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm hover:bg-slate-800/80 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4 w-4 text-cyan-400" />
                    <span className="text-slate-200">{item.label}</span>
                  </span>
                  <span className="text-[11px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded">
                    {item.category}
                  </span>
                </button>
              );
            })
          )}

          <div className="pt-2 mt-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => {
                onTriggerKillSwitch();
                onOpenChange(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-red-300 hover:bg-red-950/50 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-3 font-medium">
                <ShieldAlert className="h-4 w-4 text-red-400" />
                Acionar / Alternar Botão de Emergência (Kill Switch Global)
              </span>
              <span className="text-[11px] bg-red-950 text-red-300 border border-red-800/60 px-2 py-0.5 rounded">
                Segurança Crítica
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-4 py-2 text-[11px] text-slate-400">
          <span>Use ESC para fechar</span>
          <span>Konnexy Ads Command Center • Modo Supervisionado</span>
        </div>
      </div>
    </div>
  );
}
