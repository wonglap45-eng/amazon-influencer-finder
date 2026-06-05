import type { Page } from "playwright";
import type { AmazonPageResult } from "@/lib/types";
import { blockReasonLabel, detectBlockReason } from "./block-detector";
import { extractPublicSocialLinks } from "./social-link-extractor";

type ScrapeOutcome = Pick<
  AmazonPageResult,
  "state" | "blockedReason" | "socialLinks" | "title" | "note"
>;

async function readBodyText(page: Page) {
  return page
    .evaluate(() => document.body?.innerText ?? document.body?.textContent ?? "")
    .catch(() => "");
}

async function collectCandidates(page: Page) {
  return page
    .evaluate(() => {
      const elements = Array.from(
        document.querySelectorAll<HTMLElement>(
          "a[href], [data-href], [data-url], [data-share-url]",
        ),
      );

      return elements
        .map((element) => {
          const href =
            element.getAttribute("href") ??
            element.getAttribute("data-href") ??
            element.getAttribute("data-url") ??
            element.getAttribute("data-share-url") ??
            "";

          return {
            href,
            text: (element.textContent ?? "").trim().slice(0, 200),
            ariaLabel: element.getAttribute("aria-label") ?? "",
            title: element.getAttribute("title") ?? "",
          };
        })
        .filter((candidate) => Boolean(candidate.href));
    })
    .catch(() => []);
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

    const candidates = (await collectCandidates(page)) as Array<{
      href: string;
      text?: string;
      ariaLabel?: string;
      title?: string;
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
      state: "error",
      socialLinks: [],
      title,
      note: "未找到结果。",
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
