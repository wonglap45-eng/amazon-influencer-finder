import { getEnv } from "@/lib/config/env";
import { discoverAmazonShopUrlsForKeywords as discoverWithSerpApi } from "@/lib/serpapi/search";
import { discoverAmazonShopUrlsForKeywords as discoverWithSerper } from "@/lib/serper/search";
import type { SearchUsage } from "@/lib/types";

type DiscoveryRoundMap = Record<string, number>;

export async function discoverAmazonShopUrlsForKeywords(
  keywords: string[],
  roundsByKeyword: DiscoveryRoundMap = {},
) {
  const env = getEnv();

  if (env.searchProvider === "serper") {
    return discoverWithSerper(keywords, roundsByKeyword);
  }

  return discoverWithSerpApi(keywords, roundsByKeyword);
}

export type SearchDiscoveryResult = Awaited<ReturnType<typeof discoverAmazonShopUrlsForKeywords>> & {
  usage?: SearchUsage;
};
