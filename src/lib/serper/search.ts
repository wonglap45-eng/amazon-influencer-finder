import { getEnv } from "../config/env";
import { getAmazonShopDedupeKey, normalizeAmazonShopUrl } from "../amazon/url-normalizer";
import { normalizeKeywordKey } from "../search/keyword";
import type { SearchUsage, SearchUsageBucket } from "../types";

type SerperOrganicResult = {
  link?: string;
  displayedLink?: string;
  title?: string;
  snippet?: string;
};

type SerperResponse = {
  organic?: SerperOrganicResult[];
  organic_results?: SerperOrganicResult[];
  searchParameters?: {
    q?: string;
  };
  error?: string;
  message?: string;
};

const SERPER_PAGES = [1, 2, 3];
const SERPER_QUERY_VARIANTS = [
  (keyword: string) => `site:amazon.com/shop ${keyword}`,
  (keyword: string) => `site:amazon.com/shop/ ${keyword}`,
  (keyword: string) => `site:amazon.com "amazon.com/shop" ${keyword}`,
];

export type SerperAmazonDiscovery = {
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
  page: number,
): Promise<SerperAmazonDiscovery> {
  const env = getEnv();
  if (!env.serperApiKey) {
    throw new Error("SERPER_API_KEY is missing.");
  }

  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": env.serperApiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        q: query,
        gl: "us",
        hl: "en",
        num: 10,
        page,
      }),
    });

    const payload = (await response.json().catch(() => null)) as SerperResponse | null;

    if (!response.ok) {
      const message =
        payload?.message ??
        payload?.error ??
        `Serper request failed with status ${response.status}`;
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

    const organicResults = Array.isArray(payload?.organic)
      ? payload.organic
      : Array.isArray(payload?.organic_results)
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

export async function searchAmazonShopUrls(keyword: string): Promise<SerperAmazonDiscovery> {
  return searchAmazonShopUrlsWithRound(keyword, 0);
}

export async function searchAmazonShopUrlsWithRound(
  keyword: string,
  round: number,
): Promise<SerperAmazonDiscovery> {
  const queries = SERPER_QUERY_VARIANTS.map((buildQuery) => buildQuery(keyword));
  const pageBase = round * SERPER_PAGES.length;
  const pages = await Promise.all(
    queries.flatMap((query) =>
      SERPER_PAGES.map(async (page) => searchAmazonShopUrlsPage(keyword, query, pageBase + page)),
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
      const roundKey = `${normalizedKeyword}#${
        roundsByKeyword[normalizedKeyword] ?? 0
      }`;

      return {
        provider: "serper",
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
      provider: "serper",
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
