import {
  getKeywordDiscoveryRound,
  getKnownAmazonShopKeysFromRuns,
  getRun,
  updateRun,
} from "@/lib/job-store";
import { getEnv } from "@/lib/config/env";
import {
  discoverAmazonShopUrlsForKeyword,
} from "@/lib/search/discover";
import { normalizeKeywordKey } from "@/lib/search/keyword";
import { getAmazonShopDedupeKey } from "@/lib/amazon/url-normalizer";
import { listKnownAmazonShopKeysFromSheet } from "@/lib/sheets";
import type { AmazonPageResult, SearchUsage, SearchUsageBucket } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

type DiscoverAction = "start" | "continue_current" | "next_keyword";

const BATCH_SIZE = 30;
const MAX_ROUNDS_PER_BATCH = 3;

function hasPendingResults(results: AmazonPageResult[]) {
  return results.some((result) => result.state === "pending");
}

function emptyUsageBucket(): SearchUsageBucket {
  return {
    attemptedRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    creditsUsed: 0,
  };
}

function mergeUsage(
  current: SearchUsage | undefined,
  next: SearchUsageBucket,
  provider: SearchUsage["provider"],
  keywordKey: string,
  roundKey: string,
): SearchUsage {
  const base =
    current ?? {
      provider,
      ...emptyUsageBucket(),
      byKeyword: {},
      byRound: {},
    };

  const keywordBucket = base.byKeyword[keywordKey] ?? emptyUsageBucket();
  const roundBucket = base.byRound[roundKey] ?? emptyUsageBucket();

  return {
    provider: base.provider,
    attemptedRequests: base.attemptedRequests + next.attemptedRequests,
    successfulRequests: base.successfulRequests + next.successfulRequests,
    failedRequests: base.failedRequests + next.failedRequests,
    creditsUsed: base.creditsUsed + next.creditsUsed,
    byKeyword: {
      ...base.byKeyword,
      [keywordKey]: {
        attemptedRequests: keywordBucket.attemptedRequests + next.attemptedRequests,
        successfulRequests: keywordBucket.successfulRequests + next.successfulRequests,
        failedRequests: keywordBucket.failedRequests + next.failedRequests,
        creditsUsed: keywordBucket.creditsUsed + next.creditsUsed,
      },
    },
    byRound: {
      ...base.byRound,
      [roundKey]: {
        attemptedRequests: roundBucket.attemptedRequests + next.attemptedRequests,
        successfulRequests: roundBucket.successfulRequests + next.successfulRequests,
        failedRequests: roundBucket.failedRequests + next.failedRequests,
        creditsUsed: roundBucket.creditsUsed + next.creditsUsed,
      },
    },
  };
}

function coerceAction(value: unknown): DiscoverAction {
  if (value === "continue_current" || value === "next_keyword") {
    return value;
  }

  return "start";
}

function getActiveKeywordIndex(
  action: DiscoverAction,
  discoverySummary: {
    activeKeywordIndex?: number;
    activeKeyword?: string;
  } | null,
) {
  if (action === "next_keyword") {
    const currentIndex = discoverySummary?.activeKeywordIndex ?? 0;
    return currentIndex + 1;
  }

  const savedIndex = discoverySummary?.activeKeywordIndex;
  if (typeof savedIndex === "number" && Number.isFinite(savedIndex)) {
    return savedIndex;
  }

  return 0;
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const run = await getRun(id);

  if (!run) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (!run.keywords.length) {
    return Response.json({ error: "no_keywords" }, { status: 400 });
  }

  if (hasPendingResults(run.results)) {
    return Response.json({ error: "pending_extractions" }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = coerceAction(body.action);
  const discoverySummary = run.discoverySummary ?? null;

  if (action === "next_keyword" && !discoverySummary) {
    return Response.json({ error: "no_previous_batch" }, { status: 400 });
  }

  const activeKeywordIndex = getActiveKeywordIndex(action, discoverySummary);

  if (activeKeywordIndex < 0 || activeKeywordIndex >= run.keywords.length) {
    return Response.json({ error: "no_more_keywords" }, { status: 400 });
  }

  const activeKeyword = run.keywords[activeKeywordIndex];
  const normalizedKeyword = normalizeKeywordKey(activeKeyword);
  const env = getEnv();
  const provider = env.searchProvider === "serper" ? "serper" : "serpapi";

  try {
    const historicalRound = await getKeywordDiscoveryRound(activeKeyword, id);
    const currentRound = (run.searchRounds?.[normalizedKeyword] ?? 0) + historicalRound;

    const [sheetKnownKeys, runKnownKeys] = await Promise.all([
      listKnownAmazonShopKeysFromSheet().catch(() => new Set<string>()),
      getKnownAmazonShopKeysFromRuns(),
    ]);
    const knownKeys = new Set<string>([...sheetKnownKeys, ...runKnownKeys]);

    await updateRun(id, {
      status: "running",
      message: `正在发现关键词「${activeKeyword}」的达人主页...`,
      discoverySummary: {
        discoveredCount: 0,
        skippedCount: 0,
        roundsByKeyword: {
          ...(run.searchRounds ?? {}),
          [normalizedKeyword]: currentRound,
        },
        discoveredAt: new Date().toISOString(),
        roundsCompleted: 0,
        activeKeyword,
        activeKeywordIndex,
        batchCount: 0,
        batchLimit: BATCH_SIZE,
        awaitingDecision: false,
        canContinueCurrent: true,
        canSwitchNext: activeKeywordIndex + 1 < run.keywords.length,
      },
    });

    const discoveredUrls = new Set(run.discoveredUrls);
    let results = [...run.results];
    let totalDiscovered = 0;
    let totalSkipped = 0;
    let roundsCompleted = 0;
    let nextRound = currentRound;
    let accumulatedUsage: SearchUsage | undefined = run.searchUsage;
    let exhaustedCurrentKeyword = false;

    for (let roundIndex = 0; roundIndex < MAX_ROUNDS_PER_BATCH; roundIndex += 1) {
      if (totalDiscovered >= BATCH_SIZE) {
        break;
      }

      const roundNumber = nextRound;
      const roundDiscovery = await discoverAmazonShopUrlsForKeyword(activeKeyword, roundNumber);
      roundsCompleted += 1;
      nextRound += 1;
      accumulatedUsage = mergeUsage(
        accumulatedUsage,
        roundDiscovery.usage,
        provider,
        normalizedKeyword,
        `${normalizedKeyword}#${roundNumber}`,
      );

      const freshCandidates: AmazonPageResult[] = [];
      let skippedThisRound = 0;

      for (const candidateUrl of roundDiscovery.urls) {
        if (freshCandidates.length + totalDiscovered >= BATCH_SIZE) {
          break;
        }

        const key = getAmazonShopDedupeKey(candidateUrl);
        if (!key || knownKeys.has(key) || discoveredUrls.has(candidateUrl)) {
          skippedThisRound += 1;
          continue;
        }

        knownKeys.add(key);
        discoveredUrls.add(candidateUrl);
        freshCandidates.push({
          url: candidateUrl,
          keyword: activeKeyword,
          state: "pending",
          socialLinks: [],
          note: "待提取。",
        });
      }

      totalDiscovered += freshCandidates.length;
      totalSkipped += skippedThisRound;

      if (freshCandidates.length > 0) {
        results = [...results, ...freshCandidates];
      }

      if (roundDiscovery.urls.length === 0 || freshCandidates.length === 0) {
        exhaustedCurrentKeyword = roundDiscovery.urls.length === 0;
      }

      if (totalDiscovered >= BATCH_SIZE) {
        break;
      }

      if (roundDiscovery.urls.length === 0) {
        break;
      }
    }

    const nextSearchRounds = {
      ...(run.searchRounds ?? {}),
      [normalizedKeyword]: nextRound,
    };

    const canContinueCurrent = !exhaustedCurrentKeyword || totalDiscovered > 0;
    const canSwitchNext = activeKeywordIndex + 1 < run.keywords.length;
    const awaitingDecision = canSwitchNext || totalDiscovered > 0;

    await updateRun(id, {
      status: totalDiscovered > 0 ? "running" : hasPendingResults(results) ? "running" : "completed",
      results,
      discoveredUrls: Array.from(discoveredUrls),
      searchRounds: nextSearchRounds,
      discoverySummary: {
        discoveredCount: totalDiscovered,
        skippedCount: totalSkipped,
        roundsByKeyword: nextSearchRounds,
        discoveredAt: new Date().toISOString(),
        roundsCompleted,
        activeKeyword,
        activeKeywordIndex,
        batchCount: totalDiscovered,
        batchLimit: BATCH_SIZE,
        awaitingDecision,
        canContinueCurrent,
        canSwitchNext,
      },
      searchUsage: accumulatedUsage,
      message:
        totalDiscovered > 0
          ? awaitingDecision
            ? `已发现 ${totalDiscovered} 个候选。提取完后可继续当前关键词或切换下一个。`
            : `已发现 ${totalDiscovered} 个候选。`
          : canSwitchNext
            ? "当前关键词没有新结果，可以切换到下一个关键词。"
            : "没有发现新的候选页面。",
    });

    const refreshedRun = await getRun(id);

    return Response.json({
      ok: true,
      run: refreshedRun,
      discoveredCount: totalDiscovered,
      skippedCount: totalSkipped,
      roundsCompleted,
      searchUsage: accumulatedUsage,
      message:
        totalDiscovered > 0
          ? awaitingDecision
            ? `已发现 ${totalDiscovered} 个候选。提取完后可继续当前关键词或切换下一个。`
            : `已发现 ${totalDiscovered} 个候选。`
          : canSwitchNext
            ? "当前关键词没有新结果，可以切换到下一个关键词。"
            : "没有发现新的候选页面。",
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
