import { getEnv } from "../config/env";
import { normalizeAmazonShopUrl } from "../amazon/url-normalizer";
import { normalizeKeywordKey } from "../search/keyword";

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

const SERP_PAGES = [0, 10, 20];

const SERP_QUERY_VARIANTS = [
  (keyword: string) => `site:amazon.com/shop ${keyword}`,
  (keyword: string) => `site:amazon.com/shop/ ${keyword}`,
  (keyword: string) => `site:amazon.com "amazon.com/shop" ${keyword}`,
];

export type SerpApiAmazonDiscovery = {
  keyword: string;
  query: string;
  urls: string[];
  rawResultCount: number;
};

export type DiscoveryRoundMap = Record<string, number>;

async function searchAmazonShopUrlsPage(
  keyword: string,
  query: string,
  start: number,
): Promise<SerpApiAmazonDiscovery> {
  const env = getEnv();
  if (!env.serpapiKey) {
    throw new Error("SERPAPI_KEY is missing.");
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", env.serpapiKey);
  url.searchParams.set("num", "20");
  url.searchParams.set("start", String(start));

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

export async function searchAmazonShopUrls(keyword: string): Promise<SerpApiAmazonDiscovery> {
  return searchAmazonShopUrlsWithRound(keyword, 0);
}

export async function searchAmazonShopUrlsWithRound(
  keyword: string,
  round: number,
): Promise<SerpApiAmazonDiscovery> {
  const queries = SERP_QUERY_VARIANTS.map((buildQuery) => buildQuery(keyword));
  const baseStart = round * SERP_PAGES.length * 10;
  const pages = await Promise.all(
    queries.flatMap((query) =>
      SERP_PAGES.map(async (start) => searchAmazonShopUrlsPage(keyword, query, baseStart + start)),
    ),
  );

  const urls = Array.from(new Set(pages.flatMap((page) => page.urls)));

  return {
    keyword,
    query: pages[0]?.query ?? `site:amazon.com/shop ${keyword}`,
    urls,
    rawResultCount: pages.reduce((total, page) => total + page.rawResultCount, 0),
  };
}

export async function discoverAmazonShopUrlsForKeywords(
  keywords: string[],
  roundsByKeyword: DiscoveryRoundMap = {},
) {
  const discovered = await Promise.all(
    keywords.map(async (keyword) =>
      searchAmazonShopUrlsWithRound(keyword, roundsByKeyword[normalizeKeywordKey(keyword)] ?? 0),
    ),
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
