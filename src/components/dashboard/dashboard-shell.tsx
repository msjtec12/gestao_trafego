"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type {
  AdAccountRecordViewModel,
  AuditEventViewModel,
  ClientRecordViewModel,
  IntegrationHealthViewModel,
  MemberRecordViewModel,
  OrganizationOption,
  SyncRunViewModel,
} from "@/application/use-cases/dashboard-overview-use-case";
import type {
  NormalizedCampaign,
  NormalizedDailyMetric,
} from "@/integrations/contracts/advertising-provider";
import type { AIRecommendation } from "@/modules/ai/schemas/recommendation-schemas";
import {
  switchOrganizationAction,
  toggleEmergencyStopServerAction,
} from "@/app/actions/operational-actions";
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
  readonly authenticatedUserEmail?: string;
  readonly isDemoEnvironment?: boolean;
  readonly emergencyStopActive?: boolean;
  readonly organizations?: readonly OrganizationOption[];
  readonly clients?: readonly ClientRecordViewModel[];
  readonly adAccounts?: readonly AdAccountRecordViewModel[];
  readonly members?: readonly MemberRecordViewModel[];
  readonly integrations?: readonly IntegrationHealthViewModel[];
  readonly syncHistory?: readonly SyncRunViewModel[];
  readonly auditTrail?: readonly AuditEventViewModel[];
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
  authenticatedUserEmail,
  isDemoEnvironment = true,
  emergencyStopActive: initialEmergencyStop = false,
  organizations: initialOrgs,
  clients = [],
  adAccounts = [],
  members = [],
  integrations = [],
  syncHistory = [],
  auditTrail = [],
  campaigns,
  dailyMetrics,
  recommendations,
  domainTables = DEFAULT_DOMAIN_TABLES,
}: DashboardShellProps) {
  const router = useRouter();
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
              isDemo: isDemoEnvironment,
            },
          ],
    [initialOrgs, organizationId, organizationName, isDemoEnvironment]
  );

  const [selectedOrgId, setSelectedOrgId] = React.useState(
    organizationId || defaultOrgs[0]!.id
  );
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState("overview");
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [emergencyStopActive, setEmergencyStopActive] = React.useState(
    initialEmergencyStop
  );

  const activeOrganization = React.useMemo(
    () =>
      defaultOrgs.find((o) => o.id === selectedOrgId) ?? defaultOrgs[0]!,
    [defaultOrgs, selectedOrgId]
  );

  const handleSelectOrganizationId = React.useCallback(
    async (nextOrgId: string) => {
      setSelectedOrgId(nextOrgId);
      if (!isDemoEnvironment) {
        await switchOrganizationAction(nextOrgId);
        router.refresh();
      }
    },
    [isDemoEnvironment, router]
  );

  const handleToggleEmergencyStop = React.useCallback(async () => {
    if (!isDemoEnvironment) {
      const res = await toggleEmergencyStopServerAction();
      if (res.ok && res.emergencyStopActive !== undefined) {
        setEmergencyStopActive(res.emergencyStopActive);
        router.refresh();
        return;
      }
    }
    setEmergencyStopActive((prev) => !prev);
  }, [isDemoEnvironment, router]);

  const scrollToSection = React.useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    setMobileMenuOpen(false);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const lastSyncTimestamp = React.useMemo(() => {
    if (syncHistory[0]?.completedAtIso) {
      return `${syncHistory[0].completedAtIso} (Checkpoint: ${
        syncHistory[0].checkpointToken ?? "N/D"
      })`;
    }
    if (activeOrganization.isDemo) {
      return "26/11/2026 10:15:00 (Checkpoint ckpt-mock-20261126-v2)";
    }
    return null;
  }, [syncHistory, activeOrganization.isDemo]);

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
          onToggleEmergencyStop={handleToggleEmergencyStop}
          authenticatedUserEmail={authenticatedUserEmail}
        />

        {activeOrganization.isDemo && <DemoModeBanner />}

        <EmergencyStopAlertBanner
          emergencyStopActive={emergencyStopActive}
          onRestore={handleToggleEmergencyStop}
        />

        <DashboardOverview
          organizationName={activeOrganization.name}
          activeOrganization={activeOrganization}
          organizations={defaultOrgs}
          onSelectOrganizationId={handleSelectOrganizationId}
          clients={clients}
          adAccounts={adAccounts}
          members={members}
          integrations={integrations}
          syncHistory={syncHistory}
          auditTrail={auditTrail}
          campaigns={campaigns}
          dailyMetrics={dailyMetrics}
          recommendations={recommendations}
          domainTables={domainTables}
          emergencyStopActive={emergencyStopActive}
          lastSyncTimestamp={lastSyncTimestamp}
        />
      </div>

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onSelectSection={scrollToSection}
        onTriggerKillSwitch={handleToggleEmergencyStop}
      />
    </div>
  );
}
