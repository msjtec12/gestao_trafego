import type { TenantContext } from "@/domain/types";
import { ProviderIntegrationError } from "@/integrations/contracts/advertising-provider";
import {
  normalizeGoogleAdsCustomerId,
  PersistentPostgresGoogleAdsService,
} from "@/integrations/google-ads/google-ads-oauth-and-readonly";
import type { PinnedHttpsRequestOptions } from "@/security/secure-http-transport";
import type { RawProviderSyncBatch } from "@/workflows/incremental-sync-engine";

const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface DiscoveredGoogleAdsAccount {
  readonly customerId: string;
  readonly descriptiveName: string;
  readonly currencyCode: string;
  readonly timeZone: string;
  readonly isManager: boolean;
  readonly managerCustomerId: string | null;
  readonly status: string;
}

export interface ExactCalculatedMetrics {
  readonly impressions: number;
  readonly clicks: number;
  readonly costMicros: number;
  readonly spendExact: number;
  readonly spendCents: number;
  readonly conversions: number;
  readonly conversionValueMicros: number;
  readonly conversionValueExact: number;
  readonly ctrPct: number | null;
  readonly cpcExact: number | null;
  readonly cpcRounded: number | null;
  readonly cpaExact: number | null;
  readonly roasExact: number | null;
}

/**
 * Pure, high-precision Google Ads metric calculator.
 * - Normalizes `cost_micros` without premature rounding (`costMicros / 1_000_000`).
 * - Preserves fractional conversions (never rounds to integer).
 * - Distinguishes `0` from unavailable (`null`) when denominator is 0.
 * - Computes CTR = clicks / impressions * 100, CPC = spend / clicks,
 *   CPA = spend / conversions, ROAS = conversionValue / spend.
 */
export function computeExactGoogleAdsMetrics(params: {
  readonly impressions: number;
  readonly clicks: number;
  readonly costMicros: number;
  readonly conversions: number;
  readonly conversionValueMicros?: number;
}): ExactCalculatedMetrics {
  const impressions = Math.max(0, Math.trunc(params.impressions));
  const clicks = Math.max(0, Math.trunc(params.clicks));
  const costMicros = Math.max(0, Math.round(params.costMicros));
  const conversions = Number.isFinite(params.conversions)
    ? Math.max(0, params.conversions)
    : 0;
  const conversionValueMicros = Math.max(
    0,
    Math.round(params.conversionValueMicros ?? 0)
  );

  const spendExact = costMicros / 1_000_000;
  const spendCents = Math.round(costMicros / 10_000);
  const conversionValueExact = conversionValueMicros / 1_000_000;

  const ctrPct = impressions > 0 ? (clicks / impressions) * 100 : null;
  const cpcExact = clicks > 0 ? spendExact / clicks : null;
  const cpcRounded = cpcExact !== null ? Number(cpcExact.toFixed(2)) : null;
  const cpaExact = conversions > 0 ? spendExact / conversions : null;
  const roasExact = spendExact > 0 ? conversionValueExact / spendExact : null;

  return {
    impressions,
    clicks,
    costMicros,
    spendExact,
    spendCents,
    conversions,
    conversionValueMicros,
    conversionValueExact,
    ctrPct,
    cpcExact,
    cpcRounded,
    cpaExact,
    roasExact,
  };
}

export function validateSyncDateRange(params: {
  readonly startDate: string;
  readonly endDate: string;
}): { readonly startDate: string; readonly endDate: string } {
  const startDate = params.startDate.trim();
  const endDate = params.endDate.trim();
  if (!DATE_ISO_REGEX.test(startDate) || !DATE_ISO_REGEX.test(endDate)) {
    throw new Error(
      "Período de sincronização inválido: informe startDate e endDate no formato YYYY-MM-DD."
    );
  }
  if (startDate > endDate) {
    throw new Error(
      "Período de sincronização inválido: data inicial não pode ser maior que a data final."
    );
  }
  return { startDate, endDate };
}

function parseNumericField(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function mapGoogleCampaignStatus(
  raw: string | undefined
): "ENABLED" | "PAUSED" | "REMOVED" | "LIMITED_BY_BUDGET" | "LEARNING" {
  switch (raw?.toUpperCase()) {
    case "ENABLED":
      return "ENABLED";
    case "PAUSED":
      return "PAUSED";
    case "REMOVED":
      return "REMOVED";
    default:
      return "PAUSED";
  }
}

function mapGoogleChannelType(raw: string | undefined): string {
  switch (raw?.toUpperCase()) {
    case "SEARCH":
      return "SEARCH";
    case "PERFORMANCE_MAX":
      return "PERFORMANCE_MAX";
    case "LOCAL_SERVICES":
      return "LOCAL_SERVICES";
    default:
      return raw?.toUpperCase() || "SEARCH";
  }
}

function mapGoogleMatchType(
  raw: string | undefined
): "EXACT" | "PHRASE" | "BROAD" {
  switch (raw?.toUpperCase()) {
    case "EXACT":
      return "EXACT";
    case "PHRASE":
      return "PHRASE";
    default:
      return "BROAD";
  }
}

interface GaqlCustomerClientRow {
  readonly customerClient?: {
    readonly id?: string;
    readonly descriptiveName?: string;
    readonly currencyCode?: string;
    readonly timeZone?: string;
    readonly manager?: boolean;
    readonly status?: string;
    readonly level?: string | number;
  };
}

interface GaqlCustomerRow {
  readonly customer?: {
    readonly id?: string;
    readonly descriptiveName?: string;
    readonly currencyCode?: string;
    readonly timeZone?: string;
    readonly manager?: boolean;
  };
}

interface GaqlCampaignRow {
  readonly campaign?: {
    readonly id?: string;
    readonly name?: string;
    readonly status?: string;
    readonly advertisingChannelType?: string;
    readonly biddingStrategyType?: string;
  };
  readonly campaignBudget?: {
    readonly amountMicros?: string | number;
  };
}

interface GaqlAdGroupRow {
  readonly campaign?: { readonly id?: string };
  readonly adGroup?: {
    readonly id?: string;
    readonly name?: string;
    readonly status?: string;
    readonly cpcBidMicros?: string | number;
  };
}

interface GaqlAdGroupAdRow {
  readonly adGroup?: { readonly id?: string };
  readonly adGroupAd?: {
    readonly status?: string;
    readonly ad?: {
      readonly id?: string;
      readonly type?: string;
      readonly finalUrls?: readonly string[];
      readonly responsiveSearchAd?: {
        readonly headlines?: readonly { readonly text?: string }[];
        readonly descriptions?: readonly { readonly text?: string }[];
      };
    };
  };
}

interface GaqlKeywordRow {
  readonly adGroup?: { readonly id?: string };
  readonly adGroupCriterion?: {
    readonly criterionId?: string;
    readonly negative?: boolean;
    readonly keyword?: {
      readonly text?: string;
      readonly matchType?: string;
    };
    readonly qualityInfo?: {
      readonly qualityScore?: number | string;
    };
  };
}

interface GaqlSearchTermRow {
  readonly campaign?: { readonly id?: string };
  readonly adGroup?: { readonly id?: string };
  readonly segments?: { readonly date?: string };
  readonly searchTermView?: { readonly searchTerm?: string };
  readonly metrics?: {
    readonly impressions?: string | number;
    readonly clicks?: string | number;
    readonly costMicros?: string | number;
    readonly conversions?: string | number;
  };
}

interface GaqlConversionActionRow {
  readonly conversionAction?: {
    readonly id?: string;
    readonly name?: string;
    readonly category?: string;
    readonly attributionModelSettings?: {
      readonly attributionModel?: string;
    };
  };
}

interface GaqlDailyMetricRow {
  readonly campaign?: { readonly id?: string };
  readonly segments?: { readonly date?: string };
  readonly metrics?: {
    readonly impressions?: string | number;
    readonly clicks?: string | number;
    readonly costMicros?: string | number;
    readonly conversions?: string | number;
    readonly conversionsValue?: string | number;
  };
}

/**
 * Official Live Google Ads REST & GAQL Synchronization Adapter (READ_ONLY).
 *
 * ZERO synthetic fallbacks, ZERO MockAdsProvider, ZERO hardcoded CAMP-* / AG-* / AD-* fixtures.
 * Uses exclusively `PersistentPostgresGoogleAdsService`:
 * - `listAccessibleCustomersViaRest()`
 * - `executeReadOnlyGaqlSearchViaRest()`
 * - `refreshAccessTokenInPostgres()`
 */
export class GoogleAdsLiveSyncAdapter {
  constructor(private readonly googleService: PersistentPostgresGoogleAdsService) {}

  /**
   * Executes a Google Ads REST call with automatic OAuth token refresh on 401/expired token
   * when OAuth client credentials are supplied.
   */
  private async withAutoRefresh<T>(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly oauthClientId?: string;
    readonly oauthClientSecret?: string;
    readonly customPinnedExecutor?: PinnedHttpsRequestOptions["customPinnedExecutor"];
    readonly dnsResolver?: PinnedHttpsRequestOptions["dnsResolver"];
    readonly execute: () => Promise<T>;
  }): Promise<T> {
    try {
      return await params.execute();
    } catch (err) {
      const shouldRefresh =
        err instanceof ProviderIntegrationError &&
        err.errorCode === "AUTH_TOKEN_REVOKED" &&
        Boolean(params.oauthClientId) &&
        Boolean(params.oauthClientSecret);

      if (!shouldRefresh) {
        throw err;
      }

      await this.googleService.refreshAccessTokenInPostgres({
        context: params.context,
        integrationId: params.integrationId,
        clientId: params.oauthClientId!,
        clientSecret: params.oauthClientSecret!,
        customPinnedExecutor: params.customPinnedExecutor,
        dnsResolver: params.dnsResolver,
      });

      return await params.execute();
    }
  }

  /**
   * Discovers real authorized Google Ads accounts (both individual accounts and MCC hierarchies)
   * using `listAccessibleCustomersViaRest()` + `customer_client` GAQL queries.
   */
  public async discoverAuthorizedAccounts(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly oauthClientId?: string;
    readonly oauthClientSecret?: string;
    readonly customPinnedExecutor?: PinnedHttpsRequestOptions["customPinnedExecutor"];
    readonly dnsResolver?: PinnedHttpsRequestOptions["dnsResolver"];
  }): Promise<readonly DiscoveredGoogleAdsAccount[]> {
    const accessibleIds = await this.withAutoRefresh({
      context: params.context,
      integrationId: params.integrationId,
      oauthClientId: params.oauthClientId,
      oauthClientSecret: params.oauthClientSecret,
      customPinnedExecutor: params.customPinnedExecutor,
      dnsResolver: params.dnsResolver,
      execute: () =>
        this.googleService.listAccessibleCustomersViaRest({
          context: params.context,
          integrationId: params.integrationId,
          customPinnedExecutor: params.customPinnedExecutor,
          dnsResolver: params.dnsResolver,
        }),
    });

    const discoveredMap = new Map<string, DiscoveredGoogleAdsAccount>();

    for (const rootCustomerId of accessibleIds) {
      const rows = await this.withAutoRefresh({
        context: params.context,
        integrationId: params.integrationId,
        oauthClientId: params.oauthClientId,
        oauthClientSecret: params.oauthClientSecret,
        customPinnedExecutor: params.customPinnedExecutor,
        dnsResolver: params.dnsResolver,
        execute: () =>
          this.googleService.executeReadOnlyGaqlSearchViaRest<GaqlCustomerClientRow>(
            {
              context: params.context,
              integrationId: params.integrationId,
              customerId: rootCustomerId,
              managerCustomerId: rootCustomerId,
              gaqlQuery:
                "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.level <= 1 AND customer_client.status = 'ENABLED'",
              customPinnedExecutor: params.customPinnedExecutor,
              dnsResolver: params.dnsResolver,
            }
          ),
      });

      for (const row of rows) {
        const cc = row.customerClient;
        if (!cc?.id) continue;
        const normalizedId = normalizeGoogleAdsCustomerId(String(cc.id));
        const isManager = Boolean(cc.manager);
        const levelNum = parseNumericField(cc.level);
        const managerCustomerId =
          levelNum > 0 && normalizedId !== rootCustomerId
            ? rootCustomerId
            : null;

        if (!discoveredMap.has(normalizedId)) {
          discoveredMap.set(normalizedId, {
            customerId: normalizedId,
            descriptiveName:
              cc.descriptiveName?.trim() || `Google Ads ${normalizedId}`,
            currencyCode: (cc.currencyCode?.trim() || "BRL").toUpperCase(),
            timeZone: cc.timeZone?.trim() || "America/Sao_Paulo",
            isManager,
            managerCustomerId,
            status: cc.status?.trim() || "ENABLED",
          });
        }
      }
    }

    return Array.from(discoveredMap.values());
  }

  /**
   * Fetches a complete, verified READ_ONLY synchronization batch for a single explicitly-bound
   * Google Ads customer ID and explicit date range (`startDate` .. `endDate`).
   *
   * Throws immediately on any query failure so incomplete syncs are NEVER marked `COMPLETED`.
   */
  public async fetchLiveAccountBatch(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly customerId: string;
    readonly managerCustomerId?: string | null;
    readonly startDate: string;
    readonly endDate: string;
    readonly oauthClientId?: string;
    readonly oauthClientSecret?: string;
    readonly customPinnedExecutor?: PinnedHttpsRequestOptions["customPinnedExecutor"];
    readonly dnsResolver?: PinnedHttpsRequestOptions["dnsResolver"];
  }): Promise<RawProviderSyncBatch> {
    const normalizedCustomerId = normalizeGoogleAdsCustomerId(params.customerId);
    const { startDate, endDate } = validateSyncDateRange({
      startDate: params.startDate,
      endDate: params.endDate,
    });

    const runGaql = <T>(gaqlQuery: string) =>
      this.withAutoRefresh({
        context: params.context,
        integrationId: params.integrationId,
        oauthClientId: params.oauthClientId,
        oauthClientSecret: params.oauthClientSecret,
        customPinnedExecutor: params.customPinnedExecutor,
        dnsResolver: params.dnsResolver,
        execute: () =>
          this.googleService.executeReadOnlyGaqlSearchViaRest<T>({
            context: params.context,
            integrationId: params.integrationId,
            customerId: normalizedCustomerId,
            managerCustomerId: params.managerCustomerId ?? null,
            gaqlQuery,
            customPinnedExecutor: params.customPinnedExecutor,
            dnsResolver: params.dnsResolver,
          }),
      });

    // 1. Official customer metadata (name, currency, timezone)
    const customerRows = await runGaql<GaqlCustomerRow>(
      "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1"
    );
    const customerMeta = customerRows[0]?.customer;
    const currencyCode = (
      customerMeta?.currencyCode?.trim() || "BRL"
    ).toUpperCase();
    const timezone = customerMeta?.timeZone?.trim() || "America/Sao_Paulo";
    const accountName =
      customerMeta?.descriptiveName?.trim() ||
      `Google Ads ${normalizedCustomerId}`;

    if (customerMeta?.manager) {
      throw new Error(
        `A conta ${normalizedCustomerId} é uma conta gerenciadora (MCC). Selecione uma subconta anunciante individual para sincronizar campanhas e métricas.`
      );
    }

    // 2. Campaigns
    const campaignRows = await runGaql<GaqlCampaignRow>(
      "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'"
    );

    // 3. Ad Groups
    const adGroupRows = await runGaql<GaqlAdGroupRow>(
      "SELECT campaign.id, ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros FROM ad_group WHERE ad_group.status != 'REMOVED'"
    );

    // 4. Ads
    const adRows = await runGaql<GaqlAdGroupAdRow>(
      "SELECT ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.status FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'"
    );

    // 5. Keywords
    const keywordRows = await runGaql<GaqlKeywordRow>(
      "SELECT ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.negative, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.quality_info.quality_score FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'"
    );

    // 6. Search Terms (explicit date window)
    const searchTermRows = await runGaql<GaqlSearchTermRow>(
      `SELECT campaign.id, ad_group.id, segments.date, search_term_view.search_term, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`
    );

    // 7. Conversion Actions
    const conversionRows = await runGaql<GaqlConversionActionRow>(
      "SELECT conversion_action.id, conversion_action.name, conversion_action.category, conversion_action.attribution_model_settings.attribution_model FROM conversion_action WHERE conversion_action.status != 'REMOVED'"
    );

    // 8. Daily Metrics per Campaign (explicit date window, preserving cost_micros & fractional conversions)
    const dailyMetricRows = await runGaql<GaqlDailyMetricRow>(
      `SELECT campaign.id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`
    );

    const campaigns = campaignRows
      .filter((r) => Boolean(r.campaign?.id))
      .map((r) => ({
        externalCampaignId: String(r.campaign!.id),
        name: r.campaign!.name?.trim() || `Campanha ${r.campaign!.id}`,
        channelType: mapGoogleChannelType(r.campaign!.advertisingChannelType),
        biddingStrategy:
          r.campaign!.biddingStrategyType?.trim() || "MANUAL_CPC",
        status: mapGoogleCampaignStatus(r.campaign!.status),
        dailyBudgetMicros: parseNumericField(r.campaignBudget?.amountMicros),
      }));

    const adGroups = adGroupRows
      .filter((r) => Boolean(r.adGroup?.id && r.campaign?.id))
      .map((r) => ({
        externalAdGroupId: String(r.adGroup!.id),
        externalCampaignId: String(r.campaign!.id),
        name: r.adGroup!.name?.trim() || `Grupo ${r.adGroup!.id}`,
        defaultCpcBidMicros: parseNumericField(r.adGroup!.cpcBidMicros),
      }));

    const ads = adRows
      .filter((r) => Boolean(r.adGroupAd?.ad?.id && r.adGroup?.id))
      .map((r) => {
        const ad = r.adGroupAd!.ad!;
        return {
          externalAdId: String(ad.id),
          externalAdGroupId: String(r.adGroup!.id),
          adType: ad.type?.trim() || "RESPONSIVE_SEARCH_AD",
          headlines: (ad.responsiveSearchAd?.headlines ?? [])
            .map((h) => h.text?.trim() ?? "")
            .filter(Boolean),
          descriptions: (ad.responsiveSearchAd?.descriptions ?? [])
            .map((d) => d.text?.trim() ?? "")
            .filter(Boolean),
          finalUrl: ad.finalUrls?.[0]?.trim() || "",
        };
      });

    const keywords = keywordRows
      .filter(
        (r) =>
          Boolean(r.adGroupCriterion?.criterionId) &&
          Boolean(r.adGroupCriterion?.keyword?.text)
      )
      .map((r) => ({
        externalKeywordId: String(r.adGroupCriterion!.criterionId),
        externalAdGroupId: r.adGroup?.id ? String(r.adGroup.id) : undefined,
        text: r.adGroupCriterion!.keyword!.text!.trim(),
        matchType: mapGoogleMatchType(
          r.adGroupCriterion!.keyword!.matchType
        ),
        isNegative: Boolean(r.adGroupCriterion!.negative),
        qualityScore: r.adGroupCriterion!.qualityInfo?.qualityScore
          ? Math.round(
              parseNumericField(r.adGroupCriterion!.qualityInfo.qualityScore)
            )
          : undefined,
      }));

    const searchTerms = searchTermRows
      .filter(
        (r) =>
          Boolean(r.searchTermView?.searchTerm) && Boolean(r.segments?.date)
      )
      .map((r) => ({
        externalCampaignId: r.campaign?.id ? String(r.campaign.id) : undefined,
        externalAdGroupId: r.adGroup?.id ? String(r.adGroup.id) : undefined,
        searchTerm: r.searchTermView!.searchTerm!.trim(),
        impressions: Math.trunc(parseNumericField(r.metrics?.impressions)),
        clicks: Math.trunc(parseNumericField(r.metrics?.clicks)),
        costMicros: Math.round(parseNumericField(r.metrics?.costMicros)),
        conversions: parseNumericField(r.metrics?.conversions),
        observedDate: String(r.segments!.date),
      }));

    const conversions = conversionRows
      .filter((r) => Boolean(r.conversionAction?.id))
      .map((r) => ({
        externalConversionId: String(r.conversionAction!.id),
        name:
          r.conversionAction!.name?.trim() ||
          `Conversão ${r.conversionAction!.id}`,
        category: r.conversionAction!.category?.trim() || "DEFAULT",
        attributionModel:
          r.conversionAction!.attributionModelSettings?.attributionModel?.trim() ||
          "DATA_DRIVEN",
      }));

    const dailyMetrics = dailyMetricRows
      .filter((r) => Boolean(r.campaign?.id && r.segments?.date))
      .map((r) => ({
        externalCampaignId: String(r.campaign!.id),
        metricDate: String(r.segments!.date),
        impressions: Math.trunc(parseNumericField(r.metrics?.impressions)),
        clicks: Math.trunc(parseNumericField(r.metrics?.clicks)),
        costMicros: Math.round(parseNumericField(r.metrics?.costMicros)),
        conversions: parseNumericField(r.metrics?.conversions),
        conversionValueMicros: Math.round(
          parseNumericField(r.metrics?.conversionsValue) * 1_000_000
        ),
      }));

    // 9. Budgets aggregated per YYYY-MM from real campaign budgets + real period spend
    const totalDailyBudgetMicros = campaigns.reduce(
      (sum, c) => sum + c.dailyBudgetMicros,
      0
    );
    const spendByMonth = new Map<string, number>();
    for (const dm of dailyMetrics) {
      const month = dm.metricDate.slice(0, 7);
      spendByMonth.set(month, (spendByMonth.get(month) ?? 0) + dm.costMicros);
    }
    const budgets = Array.from(spendByMonth.entries()).map(
      ([periodMonth, spentMicros]) => ({
        periodMonth,
        allocatedMicros: totalDailyBudgetMicros * 30,
        spentMicros,
        maxDailyHardLimitMicros: totalDailyBudgetMicros,
      })
    );

    return {
      checkpointToken: `gads-v26:${normalizedCustomerId}:${startDate}:${endDate}:${Date.now()}`,
      currencyCode,
      timezone,
      isDemoData: false,
      adAccounts: [
        {
          externalAccountId: normalizedCustomerId,
          name: accountName,
          managerCustomerId: params.managerCustomerId ?? null,
          isMccAccount: false,
        },
      ],
      campaigns,
      adGroups,
      ads,
      keywords,
      searchTerms,
      conversions,
      dailyMetrics,
      budgets,
    };
  }
}
