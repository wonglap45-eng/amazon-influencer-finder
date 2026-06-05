import type { Page } from "playwright";
import type { AmazonPageResult } from "@/lib/types";
import { blockReasonLabel, detectBlockReason } from "./block-detector";
import { collectCandidateLinksFromDom, extractPublicSocialLinks } from "./social-link-extractor";

type ScrapeOutcome = Pick<
  AmazonPageResult,
  "state" | "blockedReason" | "socialLinks" | "title" | "note"
>;

async function readBodyText(page: Page) {
  return page
    .evaluate(() => document.body?.innerText ?? document.body?.textContent ?? "")
    .catch(() => "");
}

export async function scrapeAmazonShopPage(page: Page, url: string): Promise<ScrapeOutcome> {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    await page.waitForTimeout(1500);

    const currentUrl = page.url();
    const title = (await page.title().catch(() => "")).trim() || undefined;
    const bodyText = await readBodyText(page);
    const blockedReason = detectBlockReason({
      title,
      text: bodyText,
      url: currentUrl,
    });

    if (blockedReason) {
      return {
        state: "blocked",
        blockedReason,
        socialLinks: [],
        title,
        note: `已记录为 blocked：${blockReasonLabel(blockedReason)}。`,
      };
    }

    const candidates = (await page.evaluate(collectCandidateLinksFromDom).catch(() => [])) as Array<{
      href: string;
      text?: string;
      ariaLabel?: string;
      title?: string;
      alt?: string;
      className?: string;
      containerClassName?: string;
    }>;

    const socialLinks = extractPublicSocialLinks(candidates, currentUrl);

    if (socialLinks.length > 0) {
      return {
        state: "ok",
        socialLinks,
        title,
        note: `已完成 ${socialLinks.length} 个链接。`,
      };
    }

    return {
      state: "ok",
      socialLinks: [],
      title,
      note: "未找到公开社交链接。",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";

    return {
      state: "error",
      socialLinks: [],
      note: message,
    };
  }
}
