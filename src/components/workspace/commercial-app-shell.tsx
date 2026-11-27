"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  Users,
  Megaphone,
  Layers,
  FileText,
  KeyRound,
  Search,
  Target,
  Wallet,
  Sparkles,
  Lightbulb,
  Zap,
  BarChart3,
  Plug,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Sun,
  Moon,
  LogOut,
  ShieldCheck,
  OctagonAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  logoutUserAction,
  switchOrganizationAction,
} from "@/app/actions/operational-actions";
import type { OrganizationOption } from "@/application/use-cases/dashboard-overview-use-case";
import {
  COMMERCIAL_NAV_GROUPS,
  COMMERCIAL_NAV_ITEMS,
} from "./commercial-navigation";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  "visao-geral": LayoutDashboard,
  clientes: Users,
  campanhas: Megaphone,
  "grupos-de-anuncios": Layers,
  anuncios: FileText,
  "palavras-chave": KeyRound,
  "termos-de-pesquisa": Search,
  conversoes: Target,
  orcamentos: Wallet,
  ia: Sparkles,
  recomendacoes: Lightbulb,
  automacoes: Zap,
  relatorios: BarChart3,
  integracoes: Plug,
  configuracoes: Settings,
};

export interface CommercialAppShellProps {
  readonly pageTitle: string;
  readonly pageSubtitle?: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizations: readonly OrganizationOption[];
  readonly authenticatedUserEmail: string;
  readonly emergencyStopActive: boolean;
  readonly headerActions?: React.ReactNode;
  readonly children: React.ReactNode;
}

export function CommercialAppShell({
  pageTitle,
  pageSubtitle,
  organizationId,
  organizationName,
  organizations,
  authenticatedUserEmail,
  emergencyStopActive,
  headerActions,
  children,
}: CommercialAppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [switchingOrg, setSwitchingOrg] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const isNavItemActive = (href: string): boolean => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const handleSwitchOrg = async (nextOrgId: string) => {
    if (nextOrgId === organizationId) return;
    setSwitchingOrg(true);
    try {
      const res = await switchOrganizationAction(nextOrgId);
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setSwitchingOrg(false);
    }
  };

  const handleLogout = async () => {
    await logoutUserAction();
    window.location.assign("/login");
  };

  const renderNavLinks = (onNavigate?: () => void) => (
    <div className="space-y-4">
      {COMMERCIAL_NAV_GROUPS.map((group) => {
        const items = COMMERCIAL_NAV_ITEMS.filter((i) => i.group === group.key);
        return (
          <div key={group.key} className="space-y-1">
            {!collapsed && (
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {group.label}
              </p>
            )}
            {items.map((item) => {
              const Icon = ICON_MAP[item.id] ?? LayoutDashboard;
              const active = isNavItemActive(item.href);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={onNavigate}
                  data-testid={`nav-link-${item.id}`}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
                    active
                      ? "bg-cyan-500/15 text-cyan-800 dark:text-cyan-200 border border-cyan-500/30"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70"
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active
                        ? "text-cyan-600 dark:text-cyan-400"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#060d1a] text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside
        aria-label="Navegação Principal Konnexy Ads"
        className={`hidden lg:flex flex-col border-r border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#081121] transition-all duration-200 shrink-0 print:hidden ${
          collapsed ? "w-20" : "w-64"
        }`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800/90">
          <Link href="/" className="flex items-center gap-3 overflow-hidden">
            <div className="h-9 w-9 rounded-lg overflow-hidden border border-cyan-500/40 bg-[#060d1a] shrink-0">
              <Image
                src="/konnexy-logo.jpg"
                alt="Logo Konnexy Ads"
                width={36}
                height={36}
                className="object-cover h-full w-full"
                priority
              />
            </div>
            {!collapsed && (
              <div className="leading-tight">
                <span className="font-bold text-sm tracking-tight block text-slate-900 dark:text-white">
                  KONNEXY{" "}
                  <span className="text-cyan-600 dark:text-cyan-400">ADS</span>
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                  Gestão de Tráfego Pago
                </span>
              </div>
            )}
          </Link>

          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <nav
          className="flex-1 overflow-y-auto p-3"
          aria-label="Menu Comercial"
        >
          {renderNavLinks()}
        </nav>

        {!collapsed && (
          <div className="p-3 m-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400">
                Organização
              </span>
              <Badge variant="default">
                <ShieldCheck className="h-3 w-3" />
                Somente Leitura
              </Badge>
            </div>
            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
              {organizationName}
            </p>
          </div>
        )}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navegação móvel"
        >
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 w-72 max-w-[85vw] bg-white dark:bg-[#081121] border-r border-slate-200 dark:border-slate-800 flex flex-col h-full">
            <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800">
              <span className="font-bold text-sm">
                KONNEXY <span className="text-cyan-500">ADS</span>
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3">
              {renderNavLinks(() => setMobileOpen(false))}
            </nav>
          </div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800/90 bg-white/90 dark:bg-[#081121]/90 backdrop-blur print:hidden">
          <div className="h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Abrir menu de navegação"
              >
                <Menu className="h-5 w-5" />
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base sm:text-lg font-bold tracking-tight truncate">
                    {pageTitle}
                  </h1>
                  <Badge
                    variant="default"
                    data-testid="environment-scope-badge"
                    className="hidden sm:inline-flex text-[10px]"
                  >
                    AMBIENTE OPERACIONAL (SEM DADOS SIMULADOS)
                  </Badge>
                </div>
                {pageSubtitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {pageSubtitle}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {headerActions}

              {organizations.length > 1 && (
                <select
                  aria-label="Selecionar organização ativa"
                  value={organizationId}
                  disabled={switchingOrg}
                  onChange={(e) => handleSwitchOrg(e.target.value)}
                  className="hidden md:block h-8 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
                aria-label="Alternar tema claro ou escuro"
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {mounted && resolvedTheme === "dark" ? (
                  <Sun className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Moon className="h-4 w-4" aria-hidden="true" />
                )}
              </button>

              <span className="hidden xl:inline text-xs text-slate-500 dark:text-slate-400 max-w-[180px] truncate">
                {authenticatedUserEmail}
              </span>

              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="logout-btn"
                onClick={handleLogout}
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </div>
        </header>

        {emergencyStopActive && (
          <div
            role="alert"
            className="bg-red-600 text-white px-4 sm:px-6 py-2.5 text-xs font-medium flex items-center justify-between gap-2 print:hidden"
          >
            <span className="flex items-center gap-2">
              <OctagonAlert className="h-4 w-4 shrink-0" />
              Parada de Emergência ativa: todas as automações da organização
              estão suspensas.
            </span>
            <Link
              href="/configuracoes"
              className="underline font-semibold shrink-0"
            >
              Gerenciar em Configurações
            </Link>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-6">
          {children}
        </main>
      </div>
    </div>
  );
}
