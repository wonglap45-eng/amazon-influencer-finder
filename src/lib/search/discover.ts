import { getEnv } from "@/lib/config/env";
import { discoverAmazonShopUrlsForKeywords as discoverWithSerpApi } from "@/lib/serpapi/search";
import { discoverAmazonShopUrlsForKeywords as discoverWithSerper } from "@/lib/serper/search";

export async function discoverAmazonShopUrlsForKeywords(keywords: string[]) {
  const env = getEnv();

  if (env.searchProvider === "serper") {
    return discoverWithSerper(keywords);
  }

  return discoverWithSerpApi(keywords);
}
