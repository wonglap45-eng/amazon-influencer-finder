import { chromium } from "playwright";
import { getRun, updateRun } from "@/lib/job-store";
import type { AmazonPageResult } from "@/lib/types";
import { getEnv } from "@/lib/config/env";
import { randomDelayMs, sleep } from "@/lib/delay";
import { appendAmazonResultsToSheet } from "@/lib/sheets";
import { scrapeAmazonShopPage } from "./playwright-scraper";

function pendingIndices(results: AmazonPageResult[]) {
  return results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.state === "pending");
}

export async function extractAmazonSocialLinksForRun(runId: string) {
  const run = await getRun(runId);

  if (!run) {
    throw new Error("not_found");
  }

  const pending = pendingIndices(run.results);
  if (pending.length === 0) {
    await updateRun(runId, {
      status: "completed",
      message: "没有待处理页面。",
    });
    return { processed: 0 };
  }

  const env = getEnv();

  await updateRun(runId, {
    status: "running",
    message: `开始处理 ${pending.length} 个页面...`,
  });

  let results = [...run.results];
  const browser = await chromium.launch({
    headless: env.playwrightHeadless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    for (let position = 0; position < pending.length; position += 1) {
      const entry = pending[position];
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1200 },
        locale: "en-US",
      });

      try {
        if (position > 0) {
          await sleep(randomDelayMs(env.minDelayMs, env.maxDelayMs));
        }

        await updateRun(runId, {
          message: `正在处理第 ${position + 1}/${pending.length} 个页面`,
        });

        const extracted = await scrapeAmazonShopPage(page, entry.result.url);
        results = results.map((item, index) =>
          index === entry.index
            ? {
                ...item,
                ...extracted,
              }
            : item,
        );

        await appendAmazonResultsToSheet(runId, [results[entry.index]]);

        await updateRun(runId, {
          results,
          status: "running",
          message: `已完成 ${position + 1}/${pending.length} 个页面。`,
        });
      } finally {
        await page.close().catch(() => {});
      }
    }

    await updateRun(runId, {
      results,
      status: "completed",
      message: `已完成 ${pending.length} 个页面。`,
    });

    return { processed: pending.length };
  } finally {
    await browser.close().catch(() => {});
  }
}
