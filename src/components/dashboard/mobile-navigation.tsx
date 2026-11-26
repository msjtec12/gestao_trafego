"use client";

import * as React from "react";
import { X } from "lucide-react";
import { DASHBOARD_NAV_ITEMS } from "./app-sidebar";

export interface MobileNavigationProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly activeSection: string;
  readonly onSelectSection: (sectionId: string) => void;
}

export function MobileNavigation({
  open,
  onClose,
  activeSection,
  onSelectSection,
}: MobileNavigationProps) {
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 lg:hidden flex bg-slate-950/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Menu de navegação móvel"
    >
      <div className="w-72 max-w-[85vw] bg-white dark:bg-[#081121] text-slate-900 dark:text-slate-100 h-full p-4 flex flex-col justify-between border-r border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
            <span className="font-bold text-sm">
              KONNEXY <span className="text-cyan-500 dark:text-cyan-400">ADS</span>
            </span>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Fechar menu mobile"
              className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <nav className="mt-4 space-y-1.5" aria-label="Navegação Mobile">
            {DASHBOARD_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectSection(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                    isActive
                      ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  <Icon className="h-4 w-4 text-cyan-500 dark:text-cyan-400" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <button
        type="button"
        className="flex-1 h-full cursor-default"
        onClick={onClose}
        aria-label="Fechar sobreposição do menu"
        tabIndex={-1}
      />
    </div>
  );
}
