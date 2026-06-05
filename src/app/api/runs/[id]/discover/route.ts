import {
  getKeywordDiscoveryRound,
  getKnownAmazonShopUrlsFromRuns,
  getRun,
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
      message: "正在发现候选页面...",
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
      note: "待处理。",
    }));

    const discoveredUrls = Array.from(
      new Set([...run.discoveredUrls, ...newUniqueUrls.map((item) => item.url)]),
    );
    const mergedResults = [...run.results, ...results];
    const message =
      uniqueUrls.length === 0
        ? "没有找到候选页面。"
        : newUniqueUrls.length === 0
          ? `找到 ${uniqueUrls.length} 个候选，但都已在历史结果中收录，已全部跳过。`
          : skippedCount > 0
            ? `找到 ${uniqueUrls.length} 个候选，其中 ${skippedCount} 个已存在，新增 ${newUniqueUrls.length} 个。`
            : `已发现 ${newUniqueUrls.length} 个新候选。`;

    const nextStatus = newUniqueUrls.length > 0 ? "running" : "completed";
    const nextSearchRounds = Object.fromEntries(
      run.keywords.map((keyword) => {
        const key = normalizeKeywordKey(keyword);
        return [key, (roundsByKeyword[key] ?? 0) + 1] as const;
      }),
    );
    const discoverySummary = {
      discoveredCount: newUniqueUrls.length,
      skippedCount,
      roundsByKeyword: nextSearchRounds,
      discoveredAt: new Date().toISOString(),
    };

    await updateRun(id, {
      status: nextStatus,
      results: mergedResults,
      message,
      discoveredUrls,
      searchRounds: nextSearchRounds,
      discoverySummary,
    });

    const refreshedRun = await getRun(id);

    return Response.json({
      ok: true,
      run: refreshedRun,
      discovery: discovered,
      discoveredCount: newUniqueUrls.length,
      skippedCount,
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
