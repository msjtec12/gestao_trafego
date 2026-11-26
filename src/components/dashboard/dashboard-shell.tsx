"use client";

import * as React from "react";
import type {
  AdAccountRecordViewModel,
  ClientRecordViewModel,
  IntegrationHealthViewModel,
  MemberRecordViewModel,
  OrganizationOption,
} from "@/application/use-cases/dashboard-overview-use-case";
import type {
  NormalizedCampaign,
  NormalizedDailyMetric,
} from "@/integrations/contracts/advertising-provider";
import type { AIRecommendation } from "@/modules/ai/schemas/recommendation-schemas";
import { AppSidebar } from "./app-sidebar";
import { MobileNavigation } from "./mobile-navigation";
import { DashboardHeader } from "./dashboard-header";
import { DemoModeBanner } from "./demo-mode-banner";
import { EmergencyStopAlertBanner } from "./emergency-stop-control";
import { DashboardOverview } from "./dashboard-overview";
import { CommandPalette } from "./command-palette";

export interface DashboardShellProps {
  readonly organizationName: string;
  readonly organizationId: string;
  readonly organizations?: readonly OrganizationOption[];
  readonly clients?: readonly ClientRecordViewModel[];
  readonly adAccounts?: readonly AdAccountRecordViewModel[];
  readonly members?: readonly MemberRecordViewModel[];
  readonly integrations?: readonly IntegrationHealthViewModel[];
  readonly campaigns: NormalizedCampaign[];
  readonly dailyMetrics: NormalizedDailyMetric[];
  readonly recommendations: AIRecommendation[];
  readonly domainTables?: readonly string[];
}

const DEFAULT_DOMAIN_TABLES = [
  "organizations",
  "users",
  "memberships",
  "clients",
  "integrations",
  "ad_accounts",
  "campaigns",
  "ad_groups",
  "ads",
  "keywords",
  "search_terms",
  "daily_metrics",
  "conversions",
  "budgets",
  "recommendations",
  "automation_rules",
  "automation_runs",
  "approvals",
  "execution_jobs",
  "audit_logs",
  "reports",
  "notifications",
] as const;

export function DashboardShell({
  organizationName,
  organizationId,
  organizations: initialOrgs,
  clients: initialClients = [],
  adAccounts: initialAccounts = [],
  members: initialMembers = [],
  integrations: initialIntegrations = [],
  campaigns,
  dailyMetrics,
  recommendations,
  domainTables = DEFAULT_DOMAIN_TABLES,
}: DashboardShellProps) {
  const defaultOrgs: readonly OrganizationOption[] = React.useMemo(
    () =>
      initialOrgs && initialOrgs.length > 0
        ? initialOrgs
        : [
            {
              id: organizationId,
              name: organizationName,
              slug: "konnexy-demo",
              executionMode: "READ_ONLY",
              timezone: "America/Sao_Paulo",
              currencyCode: "BRL",
              maxDailyBudgetChangePct: 20,
              minCooldownMinutes: 360,
              isDemo: true,
            },
          ],
    [initialOrgs, organizationId, organizationName]
  );

  const [selectedOrgId, setSelectedOrgId] = React.useState(
    defaultOrgs[0]!.id
  );
  const [clientsList, setClientsList] =
    React.useState<readonly ClientRecordViewModel[]>(initialClients);
  const [accountsList, setAccountsList] =
    React.useState<readonly AdAccountRecordViewModel[]>(initialAccounts);
  const [integrationsList, setIntegrationsList] =
    React.useState<readonly IntegrationHealthViewModel[]>(initialIntegrations);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [lastSyncTimestamp, setLastSyncTimestamp] = React.useState<
    string | null
  >("26/11/2026 10:15:00 (Checkpoint ckpt-mock-20261126-v2)");

  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState("overview");
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [emergencyStopActive, setEmergencyStopActive] = React.useState(false);

  const activeOrganization = React.useMemo(
    () =>
      defaultOrgs.find((o) => o.id === selectedOrgId) ?? defaultOrgs[0]!,
    [defaultOrgs, selectedOrgId]
  );

  const scopedClients = React.useMemo(
    () =>
      clientsList.filter((c) => c.organizationId === activeOrganization.id),
    [clientsList, activeOrganization.id]
  );

  const scopedAccounts = React.useMemo(
    () =>
      accountsList.filter((a) => a.organizationId === activeOrganization.id),
    [accountsList, activeOrganization.id]
  );

  const scrollToSection = React.useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    setMobileMenuOpen(false);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const handleTriggerIncrementalSync = React.useCallback(() => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      setLastSyncTimestamp(
        `${new Date().toLocaleTimeString("pt-BR")} (Checkpoint incremental atualizado)`
      );
    }, 350);
  }, []);

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#060d1a] text-slate-900 dark:text-slate-100 overflow-x-hidden">
      <AppSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        activeSection={activeSection}
        onSelectSection={scrollToSection}
        organizationName={activeOrganization.name}
        organizationId={activeOrganization.id}
        isDemoEnvironment={activeOrganization.isDemo}
      />

      <MobileNavigation
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        activeSection={activeSection}
        onSelectSection={scrollToSection}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenCommandPalette={() => setCommandOpen(true)}
          emergencyStopActive={emergencyStopActive}
          onToggleEmergencyStop={() =>
            setEmergencyStopActive((prev) => !prev)
          }
        />

        <DemoModeBanner />

        <EmergencyStopAlertBanner
          emergencyStopActive={emergencyStopActive}
          onRestore={() => setEmergencyStopActive(false)}
        />

        <DashboardOverview
          organizationName={activeOrganization.name}
          activeOrganization={activeOrganization}
          organizations={defaultOrgs}
          onSelectOrganizationId={setSelectedOrgId}
          clients={scopedClients}
          adAccounts={scopedAccounts}
          members={initialMembers}
          integrations={integrationsList}
          campaigns={campaigns}
          dailyMetrics={dailyMetrics}
          recommendations={recommendations}
          domainTables={domainTables}
          emergencyStopActive={emergencyStopActive}
          onClientCreated={(newClient) =>
            setClientsList((prev) => [newClient, ...prev])
          }
          onToggleAccountSelection={(accId) =>
            setAccountsList((prev) =>
              prev.map((a) =>
                a.id === accId
                  ? { ...a, isSelectedForSync: !a.isSelectedForSync }
                  : a
              )
            )
          }
          onRevokeIntegration={(intId) =>
            setIntegrationsList((prev) =>
              prev.map((i) =>
                i.id === intId
                  ? {
                      ...i,
                      status: "REVOKED",
                      message:
                        "Integração revogada pelo administrador. Tokens removidos do Credential Vault.",
                    }
                  : i
              )
            )
          }
          onTriggerIncrementalSync={handleTriggerIncrementalSync}
          isSyncing={isSyncing}
          lastSyncTimestamp={lastSyncTimestamp}
        />
      </div>

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onSelectSection={scrollToSection}
        onTriggerKillSwitch={() => setEmergencyStopActive((prev) => !prev)}
      />
    </div>
  );
}
