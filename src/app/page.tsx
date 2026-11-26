import { MockAdsProvider } from "@/integrations/providers/ads-providers";
import { getDemoAIRecommendations } from "@/modules/ai/schemas/recommendation-schemas";
import { DEMO_ORGANIZATION } from "@/modules/organizations";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default async function HomePage() {
  const provider = new MockAdsProvider();
  const [campaigns, dailyMetrics] = await Promise.all([
    provider.listCampaigns(DEMO_ORGANIZATION.id),
    provider.getDailyMetrics(),
  ]);
  const recommendations = getDemoAIRecommendations(DEMO_ORGANIZATION.id);

  return (
    <DashboardShell
      organizationName={DEMO_ORGANIZATION.name}
      organizationId={DEMO_ORGANIZATION.id}
      campaigns={campaigns}
      dailyMetrics={dailyMetrics}
      recommendations={recommendations}
    />
  );
}
