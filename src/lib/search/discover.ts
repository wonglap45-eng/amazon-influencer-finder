import { getEnv } from "@/lib/config/env";
import {
  discoverAmazonShopUrlsForKeywords as discoverWithSerpApiKeywords,
  searchAmazonShopUrlsWithRound as searchWithSerpApiRound,
} from "@/lib/serpapi/search";
import {
  discoverAmazonShopUrlsForKeywords as discoverWithSerperKeywords,
  searchAmazonShopUrlsWithRound as searchWithSerperRound,
} from "@/lib/serper/search";
import type { SearchUsage } from "@/lib/types";

type DiscoveryRoundMap = Record<string, number>;

export async function discoverAmazonShopUrlsForKeywords(
  keywords: string[],
  roundsByKeyword: DiscoveryRoundMap = {},
) {
  const env = getEnv();

  if (env.searchProvider === "serper") {
    return discoverWithSerperKeywords(keywords, roundsByKeyword);
  }

  return discoverWithSerpApiKeywords(keywords, roundsByKeyword);
}

export async function discoverAmazonShopUrlsForKeyword(keyword: string, round = 0) {
  const env = getEnv();

  if (env.searchProvider === "serper") {
    return searchWithSerperRound(keyword, round);
  }

  return searchWithSerpApiRound(keyword, round);
}

export type SearchDiscoveryResult = Awaited<ReturnType<typeof discoverAmazonShopUrlsForKeywords>> & {
  usage?: SearchUsage;
};
