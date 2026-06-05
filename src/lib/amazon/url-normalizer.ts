function parseAmazonShopSlug(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    if (host !== "amazon.com" && !host.endsWith(".amazon.com")) {
      return null;
    }

    const path = url.pathname.replace(/\/+$/, "");
    const match = path.match(/^\/shop\/([^/]+)/i);
    if (!match?.[1]) {
      return null;
    }

    return decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeAmazonShopUrl(value: string) {
  const slug = parseAmazonShopSlug(value);
  if (!slug) {
    return null;
  }

  return `https://www.amazon.com/shop/${slug}`;
}

export function getAmazonShopDedupeKey(value: string) {
  const slug = parseAmazonShopSlug(value);
  if (!slug) {
    return null;
  }

  return `amazon-shop:${slug}`;
}

export function isAmazonShopUrl(value: string) {
  return normalizeAmazonShopUrl(value) !== null;
}
