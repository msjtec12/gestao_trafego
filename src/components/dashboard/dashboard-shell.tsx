"use client";

import * as React from "react";
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
  campaigns,
  dailyMetrics,
  recommendations,
  domainTables = DEFAULT_DOMAIN_TABLES,
}: DashboardShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState("overview");
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [emergencyStopActive, setEmergencyStopActive] = React.useState(false);

  const scrollToSection = React.useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    setMobileMenuOpen(false);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#060d1a] text-slate-900 dark:text-slate-100 overflow-x-hidden">
      <AppSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        activeSection={activeSection}
        onSelectSection={scrollToSection}
        organizationName={organizationName}
        organizationId={organizationId}
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
          organizationName={organizationName}
          campaigns={campaigns}
          dailyMetrics={dailyMetrics}
          recommendations={recommendations}
          domainTables={domainTables}
          emergencyStopActive={emergencyStopActive}
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
