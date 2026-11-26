"use client";

import * as React from "react";
import {
  LayoutDashboard,
  Megaphone,
  Sparkles,
  Cpu,
  Database,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
}

export const DASHBOARD_NAV_ITEMS: readonly NavItem[] = [
  { id: "overview", label: "Visão Geral & KPIs", icon: LayoutDashboard },
  { id: "campaigns", label: "Campanhas (Mock Demo)", icon: Megaphone },
  { id: "ai-recommendations", label: "IA Supervisionada", icon: Sparkles },
  { id: "automation-engine", label: "Motor de Automações", icon: Cpu },
  {
    id: "architecture-docs",
    label: "Domínios Drizzle & Segurança",
    icon: Database,
  },
];

export interface AppSidebarProps {
  readonly collapsed: boolean;
  readonly onToggleCollapse: () => void;
  readonly activeSection: string;
  readonly onSelectSection: (sectionId: string) => void;
  readonly organizationName: string;
  readonly organizationId: string;
}

export function AppSidebar({
  collapsed,
  onToggleCollapse,
  activeSection,
  onSelectSection,
  organizationName,
  organizationId,
}: AppSidebarProps) {
  return (
    <aside
      aria-label="Navegação Principal Konnexy Ads"
      className={`hidden lg:flex flex-col border-r border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#081121] transition-all duration-200 shrink-0 ${
        collapsed ? "w-20" : "w-68"
      }`}
    >
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800/90">
        <div className="flex items-center gap-3 overflow-hidden">
          <div
            className="h-9 w-9 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-600 dark:text-cyan-400 font-bold shrink-0"
            aria-hidden="true"
          >
            K
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <span className="font-bold text-sm tracking-tight block text-slate-900 dark:text-white">
                KONNEXY <span className="text-cyan-500 dark:text-cyan-400">ADS</span>
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                ads.konnexy.com.br
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 cursor-pointer"
          aria-label={
            collapsed ? "Expandir menu lateral" : "Recolher menu lateral"
          }
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1.5" aria-label="Seções do Dashboard">
        {DASHBOARD_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSection(item.id)}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 cursor-pointer ${
                isActive
                  ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0 text-cyan-500 dark:text-cyan-400" />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="p-4 m-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/70 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">
              Contexto Demo
            </span>
            <Badge variant="demo">MOCK TENANT</Badge>
          </div>
          <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">
            {organizationName}
          </p>
          <code className="text-[11px] text-cyan-700 dark:text-cyan-400 block truncate">
            org_id: {organizationId}
          </code>
        </div>
      )}
    </aside>
  );
}
