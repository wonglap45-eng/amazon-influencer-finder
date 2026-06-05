import {
  getKeywordDiscoveryRound,
  getKnownAmazonShopKeysFromRuns,
  getRun,
  updateRun,
} from "@/lib/job-store";
import { discoverAmazonShopUrlsForKeywords } from "@/lib/search/discover";
import { normalizeKeywordKey } from "@/lib/search/keyword";
import { getAmazonShopDedupeKey } from "@/lib/amazon/url-normalizer";
import { listKnownAmazonShopKeysFromSheet } from "@/lib/sheets";
import type { AmazonPageResult } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

const MAX_DISCOVERY_ROUNDS_PER_REQUEST = 3;

function hasPendingResults(results: AmazonPageResult[]) {
  return results.some((result) => result.state === "pending");
}

function bumpRounds(roundsByKeyword: Record<string, number>, keywords: string[]) {
  const next = { ...roundsByKeyword };

  for (const keyword of keywords) {
    const key = normalizeKeywordKey(keyword);
    next[key] = (next[key] ?? 0) + 1;
  }

  return next;
}

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
    const historicalRounds = await Promise.all(
      run.keywords.map(async (keyword) => {
        const key = normalizeKeywordKey(keyword);
        const historicalRound = await getKeywordDiscoveryRound(keyword, id);
        const currentRound = run.searchRounds?.[key] ?? 0;
        return [key, historicalRound + currentRound] as const;
      }),
    );

    let roundsByKeyword = Object.fromEntries(historicalRounds);
    const discoveredUrls = new Set(run.discoveredUrls);
    let results = [...run.results];
    let totalDiscovered = 0;
    let totalSkipped = 0;
    let roundsCompleted = 0;

    const [sheetKnownKeys, runKnownKeys] = await Promise.all([
      listKnownAmazonShopKeysFromSheet().catch(() => new Set<string>()),
      getKnownAmazonShopKeysFromRuns(),
    ]);
    const knownKeys = new Set<string>([...sheetKnownKeys, ...runKnownKeys]);

    await updateRun(id, {
      status: "running",
      message: "正在发现候选页面...",
    });

    for (let roundIndex = 0; roundIndex < MAX_DISCOVERY_ROUNDS_PER_REQUEST; roundIndex += 1) {
      const { uniqueUrls } = await discoverAmazonShopUrlsForKeywords(run.keywords, roundsByKeyword);
      roundsCompleted += 1;

      const newCandidates: AmazonPageResult[] = [];
      let skippedThisRound = 0;

      for (const candidate of uniqueUrls) {
        const key = getAmazonShopDedupeKey(candidate.url);
        if (!key || knownKeys.has(key)) {
          skippedThisRound += 1;
          continue;
        }

        knownKeys.add(key);
        discoveredUrls.add(candidate.url);
        newCandidates.push({
          url: candidate.url,
          keyword: candidate.keyword,
          state: "pending",
          socialLinks: [],
          note: "待处理。",
        });
      }

      totalDiscovered += newCandidates.length;
      totalSkipped += skippedThisRound;
      roundsByKeyword = bumpRounds(roundsByKeyword, run.keywords);

      if (newCandidates.length > 0) {
        results = [...results, ...newCandidates];
        await updateRun(id, {
          status: "running",
          results,
          discoveredUrls: Array.from(discoveredUrls),
          searchRounds: roundsByKeyword,
          discoverySummary: {
            discoveredCount: totalDiscovered,
            skippedCount: totalSkipped,
            roundsByKeyword,
            discoveredAt: new Date().toISOString(),
            roundsCompleted,
          },
          message:
            totalSkipped > 0
              ? `本次新增 ${totalDiscovered} 个，跳过 ${totalSkipped} 个。`
              : `已发现 ${totalDiscovered} 个新候选。`,
        });
      } else {
        await updateRun(id, {
          status: results.length && hasPendingResults(results) ? "running" : "completed",
          discoveredUrls: Array.from(discoveredUrls),
          searchRounds: roundsByKeyword,
          discoverySummary: {
            discoveredCount: totalDiscovered,
            skippedCount: totalSkipped,
            roundsByKeyword,
            discoveredAt: new Date().toISOString(),
            roundsCompleted,
          },
          message:
            uniqueUrls.length === 0
              ? "没有找到候选页面。"
              : totalDiscovered === 0
                ? "没有新增候选页面。"
                : `本次新增 ${totalDiscovered} 个，跳过 ${totalSkipped} 个。`,
        });

        if (uniqueUrls.length === 0) {
          break;
        }
      }
    }

    const refreshedRun = await getRun(id);

    return Response.json({
      ok: true,
      run: refreshedRun,
      discoveredCount: totalDiscovered,
      skippedCount: totalSkipped,
      roundsCompleted,
      message:
        totalDiscovered === 0
          ? "没有新增候选页面。"
          : totalSkipped > 0
            ? `本次新增 ${totalDiscovered} 个，跳过 ${totalSkipped} 个。`
            : `已发现 ${totalDiscovered} 个新候选。`,
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
