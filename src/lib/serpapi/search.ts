import { getEnv } from "../config/env";
import { normalizeAmazonShopUrl } from "../amazon/url-normalizer";

type SerpOrganicResult = {
  link?: string;
  displayed_link?: string;
  title?: string;
  snippet?: string;
};

type SerpApiResponse = {
  organic_results?: SerpOrganicResult[];
  search_metadata?: {
    status?: string;
  };
  error?: string;
  error_message?: string;
};

export type SerpApiAmazonDiscovery = {
  keyword: string;
  query: string;
  urls: string[];
  rawResultCount: number;
};

export async function searchAmazonShopUrls(keyword: string): Promise<SerpApiAmazonDiscovery> {
  const env = getEnv();
  if (!env.serpapiKey) {
    throw new Error("SERPAPI_KEY is missing.");
  }

  const query = `site:amazon.com/shop ${keyword}`;
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", env.serpapiKey);
  url.searchParams.set("num", "10");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "User-Agent": "amazon-influencer-finder/1.0",
      Accept: "application/json",
    },
  });

  const payload = (await response.json().catch(() => null)) as SerpApiResponse | null;

  if (!response.ok) {
    const message =
      payload?.error_message ??
      payload?.error ??
      `SerpAPI request failed with status ${response.status}`;
    throw new Error(message);
  }

  const organicResults = Array.isArray(payload?.organic_results)
    ? payload?.organic_results
    : [];

  const urls = Array.from(
    new Set(
      organicResults
        .map((item) => item.link ?? "")
        .map((link) => normalizeAmazonShopUrl(link))
        .filter((link): link is string => Boolean(link)),
    ),
  );

  return {
    keyword,
    query,
    urls,
    rawResultCount: organicResults.length,
  };
}

export async function discoverAmazonShopUrlsForKeywords(keywords: string[]) {
  const discovered = await Promise.all(
    keywords.map(async (keyword) => {
      const result = await searchAmazonShopUrls(keyword);
      return result;
    }),
  );

  const uniqueUrls = new Map<string, string>();
  for (const result of discovered) {
    for (const url of result.urls) {
      if (!uniqueUrls.has(url)) {
        uniqueUrls.set(url, result.keyword);
      }
    }
  }

  return {
    discovered,
    uniqueUrls: Array.from(uniqueUrls.entries()).map(([url, keyword]) => ({
      url,
      keyword,
    })),
  };
}
