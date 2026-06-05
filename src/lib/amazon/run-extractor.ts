import { chromium } from "playwright";
import { getRun, updateRun } from "@/lib/job-store";
import type { AmazonPageResult } from "@/lib/types";
import { getEnv } from "@/lib/config/env";
import { randomDelayMs, sleep } from "@/lib/delay";
import { appendAmazonResultsToSheet } from "@/lib/sheets";
import { scrapeAmazonShopPage } from "./playwright-scraper";

const MAX_EXTRACTION_ATTEMPTS = 3;

function extractionQueue(results: AmazonPageResult[]) {
  return results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => {
      if (result.state === "pending") {
        return true;
      }

      if (result.state === "error") {
        return (result.attempts ?? 0) < MAX_EXTRACTION_ATTEMPTS;
      }

      return false;
    });
}

function updateResultAtIndex(
  results: AmazonPageResult[],
  index: number,
  patch: Partial<AmazonPageResult>,
) {
  return results.map((item, itemIndex) =>
    itemIndex === index
      ? {
          ...item,
          ...patch,
        }
      : item,
  );
}

export async function extractAmazonSocialLinksForRun(runId: string) {
  const run = await getRun(runId);

  if (!run) {
    throw new Error("not_found");
  }

  const queue = extractionQueue(run.results);
  if (queue.length === 0) {
    await updateRun(runId, {
      status: "completed",
      message: "没有可处理页面。",
    });
    return { processed: 0 };
  }

  const env = getEnv();

  await updateRun(runId, {
    status: "running",
    message: `开始处理 ${queue.length} 个页面...`,
  });

  let results = [...run.results];
  const browser = await chromium.launch({
    headless: env.playwrightHeadless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    for (let position = 0; position < queue.length; position += 1) {
      const entry = queue[position];
      const startedAt = new Date().toISOString();
      const currentAttempt = (results[entry.index].attempts ?? 0) + 1;
      const attemptPatch: Partial<AmazonPageResult> = {
        attempts: currentAttempt,
        lastAttemptAt: startedAt,
        lastError: undefined,
      };

      results = updateResultAtIndex(results, entry.index, attemptPatch);
      await updateRun(runId, {
        results,
        status: "running",
        message: `处理中 ${position + 1}/${queue.length}...`,
      });

      const page = await browser.newPage({
        viewport: { width: 1440, height: 1200 },
        locale: "en-US",
      });

      try {
        if (position > 0) {
          await sleep(randomDelayMs(env.minDelayMs, env.maxDelayMs));
        }

        const extracted = await scrapeAmazonShopPage(page, entry.result.url);
        const current = results[entry.index];
        const nextResult: AmazonPageResult = {
          ...current,
          ...extracted,
          attempts: current.attempts ?? currentAttempt,
          lastAttemptAt: startedAt,
          lastError: extracted.state === "error" ? extracted.note ?? "unknown_error" : undefined,
        };

        results = updateResultAtIndex(results, entry.index, nextResult);

        await appendAmazonResultsToSheet(runId, [nextResult]);

        await updateRun(runId, {
          results,
          status: "running",
          message: `已完成 ${position + 1}/${queue.length} 个页面。`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        const current = results[entry.index];
        const nextResult: AmazonPageResult = {
          ...current,
          state: "error",
          note: message,
          lastError: message,
        };

        results = updateResultAtIndex(results, entry.index, nextResult);
        await appendAmazonResultsToSheet(runId, [nextResult]);

        await updateRun(runId, {
          results,
          status: "running",
          message: `已完成 ${position + 1}/${queue.length} 个页面。`,
        });
      } finally {
        await page.close().catch(() => {});
      }
    }

    await updateRun(runId, {
      results,
      status: "completed",
      message: `已完成 ${queue.length} 个页面。`,
    });

    return { processed: queue.length };
  } finally {
    await browser.close().catch(() => {});
  }
}
