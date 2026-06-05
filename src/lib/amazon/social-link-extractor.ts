import type { SocialLink, SocialLinkType } from "@/lib/types";

type CandidateLink = {
  href: string;
  text?: string;
  ariaLabel?: string;
  title?: string;
  alt?: string;
  className?: string;
  containerClassName?: string;
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

function hostMatchesDomain(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function platformLabelFromHost(host: string) {
  if (hostMatchesDomain(host, "instagram.com") || host.includes("instagr.am")) return "Instagram";
  if (hostMatchesDomain(host, "tiktok.com")) return "TikTok";
  if (hostMatchesDomain(host, "youtube.com") || host === "youtu.be") return "YouTube";
  if (hostMatchesDomain(host, "facebook.com") || host === "fb.me" || host === "fb.watch") {
    return "Facebook";
  }
  if (hostMatchesDomain(host, "pinterest.com") || hostMatchesDomain(host, "pinterest.co") || host === "pin.it") {
    return "Pinterest";
  }
  if (hostMatchesDomain(host, "linktr.ee") || hostMatchesDomain(host, "linktree")) return "Linktree";
  if (hostMatchesDomain(host, "x.com") || hostMatchesDomain(host, "twitter.com") || host === "t.co") {
    return "X";
  }
  if (hostMatchesDomain(host, "threads.net")) return "Threads";
  if (hostMatchesDomain(host, "snapchat.com")) return "Snapchat";
  if (hostMatchesDomain(host, "twitch.tv")) return "Twitch";
  if (hostMatchesDomain(host, "reddit.com")) return "Reddit";
  if (hostMatchesDomain(host, "beacons.ai") || hostMatchesDomain(host, "beacons.page")) {
    return "Beacons";
  }
  if (hostMatchesDomain(host, "solo.to")) return "Solo.to";
  if (hostMatchesDomain(host, "bio.site")) return "Bio.site";
  if (hostMatchesDomain(host, "lnk.bio")) return "Lnk.Bio";
  if (hostMatchesDomain(host, "taplink.cc")) return "Taplink";
  if (hostMatchesDomain(host, "link.bio")) return "Link.bio";
  if (hostMatchesDomain(host, "heylink.me")) return "HeyLink";
  if (hostMatchesDomain(host, "carrd.co")) return "Carrd";
  return host.replace(/^www\./, "");
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

function isLikelySocialCandidate(candidate: CandidateLink, host: string) {
  const blob = [
    candidate.text ?? "",
    candidate.ariaLabel ?? "",
    candidate.title ?? "",
    candidate.alt ?? "",
    candidate.className ?? "",
    candidate.containerClassName ?? "",
    host,
  ]
    .join(" ")
    .toLowerCase();

  if (blob.includes("social-media") || blob.includes("social icon")) return true;
  if (blob.includes("instagram")) return true;
  if (blob.includes("tiktok")) return true;
  if (blob.includes("youtube")) return true;
  if (blob.includes("facebook")) return true;
  if (blob.includes("linktree") || blob.includes("linktr.ee")) return true;
  if (blob.includes("website")) return true;
  if (blob.includes("link bio") || blob.includes("bio")) return true;

  return false;
}

function classifyLink(url: URL, candidate: CandidateLink): SocialLinkType {
  const host = hostnameFor(url.hostname);
  const haystack = [
    host,
    url.pathname,
    candidate.text ?? "",
    candidate.ariaLabel ?? "",
    candidate.title ?? "",
    candidate.alt ?? "",
    candidate.className ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("instagram") || host.includes("instagr.am")) return "instagram";
  if (haystack.includes("tiktok")) return "tiktok";
  if (haystack.includes("youtube") || host === "youtu.be") return "youtube";
  if (haystack.includes("facebook") || host === "fb.me") return "facebook";
  if (haystack.includes("pinterest") || host === "pin.it") return "pinterest";
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

    const normalized = normalizeUrl(url.toString());
    const key = normalized;
    const socialHost =
      hostMatchesDomain(url.hostname.toLowerCase(), "instagram.com") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "tiktok.com") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "youtube.com") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "facebook.com") ||
      host === "pin.it" ||
      hostMatchesDomain(url.hostname.toLowerCase(), "pinterest.com") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "pinterest.co") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "linktr.ee") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "linktree") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "x.com") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "twitter.com") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "threads.net") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "snapchat.com") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "twitch.tv") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "reddit.com") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "beacons.ai") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "beacons.page") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "solo.to") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "bio.site") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "lnk.bio") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "taplink.cc") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "link.bio") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "heylink.me") ||
      hostMatchesDomain(url.hostname.toLowerCase(), "carrd.co");

    if (!socialHost && !isLikelySocialCandidate(candidate, host)) {
      continue;
    }

    const type = classifyLink(url, candidate);

    if (!unique.has(key)) {
      unique.set(key, {
        type,
        url: normalized,
        platform: platformLabelFromHost(host),
        host,
        key,
      });
    }
  }

  return Array.from(unique.values()).map((item) => ({
    type: item.type,
    url: item.url,
    platform: item.platform,
    host: item.host,
  }));
}

export function collectCandidateLinksFromDom() {
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(
      "a[href], [data-href], [data-url], [data-share-url], img.social-media-icon, img[alt]",
    ),
  );

  return elements
    .map((element) => {
      const anchor =
        element.tagName === "A"
          ? element
          : (element.closest("a[href], [data-href], [data-url], [data-share-url]") as
              | HTMLElement
              | null);

      const href =
        element.getAttribute("href") ??
        element.getAttribute("data-href") ??
        element.getAttribute("data-url") ??
        element.getAttribute("data-share-url") ??
        anchor?.getAttribute("href") ??
        anchor?.getAttribute("data-href") ??
        anchor?.getAttribute("data-url") ??
        anchor?.getAttribute("data-share-url") ??
        "";

      const alt =
        element.getAttribute("alt") ??
        (anchor?.getAttribute("alt") ?? "") ??
        (anchor?.querySelector("img[alt]")?.getAttribute("alt") ?? "");

      const className =
        typeof element.className === "string"
          ? element.className
          : typeof anchor?.className === "string"
            ? anchor.className
            : "";

      const containerClassName =
        typeof anchor?.parentElement?.className === "string"
          ? anchor.parentElement.className
          : typeof element.parentElement?.className === "string"
            ? element.parentElement.className
            : "";

      const ariaLabel =
        element.getAttribute("aria-label") ??
        anchor?.getAttribute("aria-label") ??
        anchor?.querySelector("[aria-label]")?.getAttribute("aria-label") ??
        "";

      const title =
        element.getAttribute("title") ??
        anchor?.getAttribute("title") ??
        anchor?.querySelector("[title]")?.getAttribute("title") ??
        "";

      const text =
        (element.textContent ?? anchor?.textContent ?? "")
          .trim()
          .slice(0, 200);

      return {
        href,
        text,
        ariaLabel,
        title,
        alt,
        className,
        containerClassName,
      };
    })
    .filter((candidate) => Boolean(candidate.href));
}
