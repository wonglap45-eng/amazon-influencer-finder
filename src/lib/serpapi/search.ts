import { getEnv } from "../config/env";
import { getAmazonShopDedupeKey, normalizeAmazonShopUrl } from "../amazon/url-normalizer";
import { normalizeKeywordKey } from "../search/keyword";
import type { SearchUsage, SearchUsageBucket } from "../types";

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
  usage: SearchUsageBucket;
  error?: string;
};

export type DiscoveryRoundMap = Record<string, number>;

function emptyBucket(): SearchUsageBucket {
  return {
    attemptedRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    creditsUsed: 0,
  };
}

function addBucket(acc: SearchUsageBucket, bucket: SearchUsageBucket): SearchUsageBucket {
  return {
    attemptedRequests: acc.attemptedRequests + bucket.attemptedRequests,
    successfulRequests: acc.successfulRequests + bucket.successfulRequests,
    failedRequests: acc.failedRequests + bucket.failedRequests,
    creditsUsed: acc.creditsUsed + bucket.creditsUsed,
  };
}

async function searchAmazonShopUrlsPage(
  keyword: string,
  query: string,
  start: number,
): Promise<SerpApiAmazonDiscovery> {
  const env = getEnv();
  if (!env.serpapiKey) {
    throw new Error("SERPAPI_KEY is missing.");
  }

  try {
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
      return {
        keyword,
        query,
        urls: [],
        rawResultCount: 0,
        usage: {
          attemptedRequests: 1,
          successfulRequests: 0,
          failedRequests: 1,
          creditsUsed: 0,
        },
        error: message,
      };
    }

    const organicResults = Array.isArray(payload?.organic_results)
      ? payload.organic_results
      : [];

    const urls = Array.from(
      new Map(
        organicResults
          .map((item) => item.link ?? "")
          .map((link) => normalizeAmazonShopUrl(link))
          .filter((link): link is string => Boolean(link))
          .map((url) => [getAmazonShopDedupeKey(url) ?? url, url] as const),
      ).values(),
    );

    return {
      keyword,
      query,
      urls,
      rawResultCount: organicResults.length,
      usage: {
        attemptedRequests: 1,
        successfulRequests: 1,
        failedRequests: 0,
        creditsUsed: 1,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return {
      keyword,
      query,
      urls: [],
      rawResultCount: 0,
      usage: {
        attemptedRequests: 1,
        successfulRequests: 0,
        failedRequests: 1,
        creditsUsed: 0,
      },
      error: message,
    };
  }
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

  const urls = Array.from(
    new Map(
      pages
        .flatMap((page) => page.urls)
        .map((url) => [getAmazonShopDedupeKey(url) ?? url, url] as const),
    ).values(),
  );

  const usage = pages.reduce<SearchUsageBucket>(
    (acc, page) => addBucket(acc, page.usage),
    emptyBucket(),
  );

  return {
    keyword,
    query: pages[0]?.query ?? `site:amazon.com/shop ${keyword}`,
    urls,
    rawResultCount: pages.reduce((total, page) => total + page.rawResultCount, 0),
    usage,
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

  const usage = discovered.reduce<SearchUsage>(
    (acc, item) => {
      const normalizedKeyword = normalizeKeywordKey(item.keyword);
      const roundKey = `${normalizedKeyword}#${roundsByKeyword[normalizedKeyword] ?? 0}`;

      return {
        provider: "serpapi",
        attemptedRequests: acc.attemptedRequests + item.usage.attemptedRequests,
        successfulRequests: acc.successfulRequests + item.usage.successfulRequests,
        failedRequests: acc.failedRequests + item.usage.failedRequests,
        creditsUsed: acc.creditsUsed + item.usage.creditsUsed,
        byKeyword: {
          ...acc.byKeyword,
          [normalizedKeyword]: addBucket(acc.byKeyword[normalizedKeyword] ?? emptyBucket(), item.usage),
        },
        byRound: {
          ...acc.byRound,
          [roundKey]: addBucket(acc.byRound[roundKey] ?? emptyBucket(), item.usage),
        },
      };
    },
    {
      provider: "serpapi",
      ...emptyBucket(),
      byKeyword: {},
      byRound: {},
    },
  );

  return {
    discovered,
    uniqueUrls: Array.from(uniqueUrls.entries()).map(([url, keyword]) => ({
      url,
      keyword,
    })),
    usage,
  };
}
