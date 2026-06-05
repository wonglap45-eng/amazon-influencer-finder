import { getEnv } from "@/lib/config/env";
import {
  getKeywordDiscoveryRound,
  getKnownAmazonShopUrlsFromRuns,
  getRun,
  setRunResults,
  updateRun,
} from "@/lib/job-store";
import { discoverAmazonShopUrlsForKeywords } from "@/lib/search/discover";
import { normalizeKeywordKey } from "@/lib/search/keyword";
import { listKnownAmazonShopUrlsFromSheet } from "@/lib/sheets";
import type { AmazonPageResult } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  const run = await getRun(id);
  const env = getEnv();
  const provider = env.searchProvider === "serper" ? "Serper" : "SerpAPI";

  if (!run) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (!run.keywords.length) {
    return Response.json({ error: "no_keywords" }, { status: 400 });
  }

  try {
    const roundsByKeywordEntries = await Promise.all(
      run.keywords.map(async (keyword) => {
        const key = normalizeKeywordKey(keyword);
        const historicalRound = await getKeywordDiscoveryRound(keyword, id);
        const currentRound = run.searchRounds?.[key] ?? 0;
        return [key, historicalRound + currentRound] as const;
      }),
    );
    const roundsByKeyword = Object.fromEntries(roundsByKeywordEntries);

    await updateRun(id, {
      status: "running",
      message: `正在使用 ${provider} 继续发现 Amazon 达人主页（会自动进入更深一轮搜索）...`,
    });

    const { discovered, uniqueUrls } = await discoverAmazonShopUrlsForKeywords(
      run.keywords,
      roundsByKeyword,
    );

    const [sheetKnownUrls, runKnownUrls] = await Promise.all([
      listKnownAmazonShopUrlsFromSheet().catch(() => new Set<string>()),
      getKnownAmazonShopUrlsFromRuns(),
    ]);

    const knownUrls = new Set<string>([...sheetKnownUrls, ...runKnownUrls]);
    const newUniqueUrls = uniqueUrls.filter(({ url }) => !knownUrls.has(url));
    const skippedCount = uniqueUrls.length - newUniqueUrls.length;

    const results: AmazonPageResult[] = newUniqueUrls.map(({ url, keyword }) => ({
      url,
      keyword,
      state: "pending",
      socialLinks: [],
      note: "已归一化为达人主页，等待 Playwright 提取。",
    }));

    const discoveredUrls = newUniqueUrls.map((item) => item.url);
    const message =
      uniqueUrls.length === 0
        ? `${provider} 没有找到 Amazon 达人主页候选。`
        : newUniqueUrls.length === 0
          ? `${provider} 找到 ${uniqueUrls.length} 个候选，但它们都已在历史结果中收录，已全部跳过。`
          : skippedCount > 0
            ? `${provider} 找到 ${uniqueUrls.length} 个候选，其中 ${skippedCount} 个已存在，新增 ${newUniqueUrls.length} 个。`
            : `${provider} 已发现 ${newUniqueUrls.length} 个新的 Amazon 达人主页候选。`;

    const nextStatus = newUniqueUrls.length > 0 ? "running" : "completed";
    const nextRun = await setRunResults(id, results, nextStatus, message);
    const nextSearchRounds = Object.fromEntries(
      run.keywords.map((keyword) => {
        const key = normalizeKeywordKey(keyword);
        return [key, (roundsByKeyword[key] ?? 0) + 1] as const;
      }),
    );

    await updateRun(id, {
      discoveredUrls,
      searchRounds: nextSearchRounds,
    });

    const refreshedRun = nextRun ?? (await getRun(id));

    return Response.json({
      ok: true,
      run: refreshedRun,
      discovery: discovered,
      discoveredCount: newUniqueUrls.length,
      skippedCount,
      provider,
      message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";

    await updateRun(id, {
      status: "failed",
      message,
    });

    return Response.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
