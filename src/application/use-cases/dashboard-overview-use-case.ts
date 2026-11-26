import { MockAdsProvider } from "@/integrations/providers/ads-providers";
import type {
  NormalizedCampaign,
  NormalizedDailyMetric,
} from "@/integrations/contracts/advertising-provider";
import {
  getDemoAIRecommendations,
  type AIRecommendation,
} from "@/modules/ai/schemas/recommendation-schemas";
import { DEMO_ORGANIZATION } from "@/modules/organizations";
import { ALL_DOMAIN_TABLES } from "@/infrastructure/db/schema";

export interface DashboardOverviewViewModel {
  readonly organizationName: string;
  readonly organizationId: string;
  readonly defaultExecutionMode: "READ_ONLY";
  readonly isDemoEnvironment: true;
  readonly isServerKillSwitchPersisted: false;
  readonly campaigns: NormalizedCampaign[];
  readonly dailyMetrics: NormalizedDailyMetric[];
  readonly recommendations: AIRecommendation[];
  readonly domainTables: readonly string[];
}

export async function getDashboardOverviewUseCase(): Promise<DashboardOverviewViewModel> {
  const provider = new MockAdsProvider();
  const [campaigns, dailyMetrics] = await Promise.all([
    provider.listCampaigns(DEMO_ORGANIZATION.id),
    provider.getDailyMetrics(),
  ]);
  const recommendations = getDemoAIRecommendations(DEMO_ORGANIZATION.id);

  return {
    organizationName: DEMO_ORGANIZATION.name,
    organizationId: DEMO_ORGANIZATION.id,
    defaultExecutionMode: "READ_ONLY",
    isDemoEnvironment: true,
    isServerKillSwitchPersisted: false,
    campaigns,
    dailyMetrics,
    recommendations,
    domainTables: ALL_DOMAIN_TABLES,
  };
}
