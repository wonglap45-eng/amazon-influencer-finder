export function normalizeAmazonShopUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    if (host !== "amazon.com" && !host.endsWith(".amazon.com")) {
      return null;
    }

    const path = url.pathname.replace(/\/+$/, "");
    const match = path.match(/^\/shop\/([^/]+)/i);
    if (!match) {
      return null;
    }

    return `https://www.amazon.com/shop/${match[1]}`;
  } catch {
    return null;
  }
}

export function isAmazonShopUrl(value: string) {
  return normalizeAmazonShopUrl(value) !== null;
}
