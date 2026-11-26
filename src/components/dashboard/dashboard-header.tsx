"use client";

import * as React from "react";
import { LogOut, Menu, Moon, Search, ShieldCheck, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { logoutUserAction } from "@/app/actions/operational-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmergencyStopControl } from "./emergency-stop-control";

export interface DashboardHeaderProps {
  readonly onOpenMobileMenu: () => void;
  readonly onOpenCommandPalette: () => void;
  readonly emergencyStopActive: boolean;
  readonly onToggleEmergencyStop: () => void;
  readonly authenticatedUserEmail?: string;
}

export function DashboardHeader({
  onOpenMobileMenu,
  onOpenCommandPalette,
  emergencyStopActive,
  onToggleEmergencyStop,
  authenticatedUserEmail,
}: DashboardHeaderProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handleLogout = async () => {
    await logoutUserAction();
    window.location.assign("/login");
  };

  return (
    <header className="sticky top-0 z-30 min-h-16 border-b border-slate-200 dark:border-slate-800/90 bg-white/95 dark:bg-[#081121]/95 backdrop-blur-md px-3 sm:px-4 lg:px-8 py-2 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          aria-label="Abrir menu de navegação"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2 sm:gap-3 rounded-lg border border-slate-300 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-900/90 px-2.5 sm:px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:border-cyan-500/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 cursor-pointer"
          aria-label="Abrir Command Palette (Ctrl+K)"
        >
          <Search
            className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400 shrink-0"
            aria-hidden="true"
          />
          <span className="hidden md:inline">
            Buscar comandos ou campanhas...
          </span>
          <kbd className="rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
            Ctrl+K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="default" className="hidden xl:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          MODO PADRÃO: SOMENTE LEITURA (READ_ONLY)
        </Badge>

        <EmergencyStopControl
          emergencyStopActive={emergencyStopActive}
          onToggle={onToggleEmergencyStop}
        />

        {authenticatedUserEmail && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleLogout}
            data-testid="logout-btn"
            aria-label={`Sair da sessão (${authenticatedUserEmail})`}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Sair</span>
          </Button>
        )}

        {mounted && (
          <button
            type="button"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
            className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 cursor-pointer"
            aria-label="Alternar tema claro ou escuro"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4 text-amber-400" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4 text-slate-700" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </header>
  );
}
