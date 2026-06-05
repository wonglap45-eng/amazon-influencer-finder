export function normalizeKeywordKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
