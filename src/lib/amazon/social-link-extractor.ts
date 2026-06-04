import type { SocialLink, SocialLinkType } from "@/lib/types";

type CandidateLink = {
  href: string;
  text?: string;
  ariaLabel?: string;
  title?: string;
};

type ClassifiedLink = SocialLink & {
  key: string;
};

function normalizeUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

function hostnameFor(value: string) {
  return value.toLowerCase().replace(/^www\./, "");
}

function isAmazonHost(host: string) {
  return (
    host === "amazon.com" ||
    host.endsWith(".amazon.com") ||
    host === "amazonaws.com" ||
    host.endsWith(".amazonaws.com") ||
    host === "amzn.to"
  );
}

function classifyLink(url: URL, candidate: CandidateLink): SocialLinkType {
  const host = hostnameFor(url.hostname);
  const haystack = [
    host,
    url.pathname,
    candidate.text ?? "",
    candidate.ariaLabel ?? "",
    candidate.title ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("instagram") || host.includes("instagr.am")) return "instagram";
  if (haystack.includes("tiktok")) return "tiktok";
  if (haystack.includes("youtube") || host === "youtu.be") return "youtube";
  if (haystack.includes("facebook") || host === "fb.me") return "facebook";
  if (haystack.includes("linktr.ee") || haystack.includes("linktree")) return "linktree";

  return "website";
}

export function extractPublicSocialLinks(
  candidates: CandidateLink[],
  baseUrl: string,
): SocialLink[] {
  const unique = new Map<string, ClassifiedLink>();

  for (const candidate of candidates) {
    const rawHref = candidate.href.trim();
    if (!rawHref) continue;

    let url: URL;
    try {
      url = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      continue;
    }

    const host = hostnameFor(url.hostname);
    if (isAmazonHost(host)) {
      continue;
    }

    const type = classifyLink(url, candidate);
    const normalized = normalizeUrl(url.toString());
    const key = `${type}:${normalized}`;

    if (!unique.has(key)) {
      unique.set(key, {
        type,
        url: normalized,
        key,
      });
    }
  }

  return Array.from(unique.values()).map((item) => ({
    type: item.type,
    url: item.url,
  }));
}

export function collectCandidateLinksFromDom() {
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>("a[href], [data-href], [data-url], [data-share-url]"),
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
}
