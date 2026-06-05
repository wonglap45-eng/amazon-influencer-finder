import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getEnv } from "./config/env";
import { getAmazonShopDedupeKey } from "./amazon/url-normalizer";
import { getSheetsClient, quoteSheetTabName } from "./sheets";
import type { AmazonPageResult, DiscoverySummary, RunRecord, RunStatus } from "./types";
import { normalizeKeywordKey } from "./search/keyword";

type StoreShape = {
  version: 1;
  runs: RunRecord[];
};

const storePath = join(process.cwd(), "data", "jobs.json");
const stateTabName = "__run_state";

let storeCache: StoreShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function createEmptyStore(): StoreShape {
  return { version: 1, runs: [] };
}

function sortRuns(runs: RunRecord[]) {
  return [...runs].sort((a, b) => {
    const left = (b.updatedAt ?? b.createdAt) || "";
    const right = (a.updatedAt ?? a.createdAt) || "";
    return left.localeCompare(right);
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

function asRecordOfNumbers(value: unknown): Record<string, number> {
  if (!isObject(value)) return {};

  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const num = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(num)) {
      result[key] = num;
    }
  }
  return result;
}

function asDiscoverySummary(value: unknown): DiscoverySummary | undefined {
  if (!isObject(value)) return undefined;

  const discoveredCount = Number(value.discoveredCount ?? 0);
  const skippedCount = Number(value.skippedCount ?? 0);
  const discoveredAt = typeof value.discoveredAt === "string" ? value.discoveredAt : "";
  const roundsByKeyword = asRecordOfNumbers(value.roundsByKeyword);
  const roundsCompleted = value.roundsCompleted == null ? undefined : Number(value.roundsCompleted);

  if (!discoveredAt) return undefined;

  return {
    discoveredCount: Number.isFinite(discoveredCount) ? discoveredCount : 0,
    skippedCount: Number.isFinite(skippedCount) ? skippedCount : 0,
    roundsByKeyword,
    discoveredAt,
    ...(Number.isFinite(roundsCompleted ?? NaN) ? { roundsCompleted } : {}),
  };
}

function asSocialLinks(value: unknown): AmazonPageResult["socialLinks"] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!isObject(item)) return null;

      const type = item.type;
      const url = item.url;
      if (typeof type !== "string" || typeof url !== "string" || !type || !url) {
        return null;
      }

      const link: AmazonPageResult["socialLinks"][number] = {
        type: type as AmazonPageResult["socialLinks"][number]["type"],
        url,
      };

      if (typeof item.platform === "string" && item.platform) {
        link.platform = item.platform;
      }

      if (typeof item.host === "string" && item.host) {
        link.host = item.host;
      }

      return link;
    })
    .filter((item): item is AmazonPageResult["socialLinks"][number] => Boolean(item));
}

function asAmazonPageResult(value: unknown): AmazonPageResult | null {
  if (!isObject(value)) return null;

  const url = typeof value.url === "string" ? value.url.trim() : "";
  const keyword = typeof value.keyword === "string" ? value.keyword.trim() : "";
  const state = value.state;

  if (!url || !keyword || (state !== "pending" && state !== "ok" && state !== "blocked" && state !== "error")) {
    return null;
  }

  const result: AmazonPageResult = {
    url,
    keyword,
    state,
    socialLinks: asSocialLinks(value.socialLinks),
  };

  if (typeof value.blockedReason === "string") {
    result.blockedReason = value.blockedReason as AmazonPageResult["blockedReason"];
  }

  if (typeof value.title === "string" && value.title) {
    result.title = value.title;
  }

  if (typeof value.note === "string" && value.note) {
    result.note = value.note;
  }

  if (typeof value.attempts === "number" && Number.isFinite(value.attempts)) {
    result.attempts = value.attempts;
  }

  if (typeof value.lastAttemptAt === "string" && value.lastAttemptAt) {
    result.lastAttemptAt = value.lastAttemptAt;
  }

  if (typeof value.lastError === "string" && value.lastError) {
    result.lastError = value.lastError;
  }

  return result;
}

function asRunRecord(value: unknown): RunRecord | null {
  if (!isObject(value)) return null;

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt.trim() : "";
  const status = value.status;
  const keywords = asStringArray(value.keywords);
  const discoveredUrls = asStringArray(value.discoveredUrls);
  const results = Array.isArray(value.results)
    ? value.results.map(asAmazonPageResult).filter((item): item is AmazonPageResult => Boolean(item))
    : [];

  if (!id || !createdAt) return null;
  if (status !== "queued" && status !== "running" && status !== "completed" && status !== "failed") {
    return null;
  }

  const run: RunRecord = {
    id,
    createdAt,
    status,
    keywords,
    discoveredUrls,
    results,
  };

  if (typeof value.updatedAt === "string" && value.updatedAt) {
    run.updatedAt = value.updatedAt;
  }

  if (isObject(value.searchRounds)) {
    run.searchRounds = asRecordOfNumbers(value.searchRounds);
  }

  const discoverySummary = asDiscoverySummary(value.discoverySummary);
  if (discoverySummary) {
    run.discoverySummary = discoverySummary;
  }

  if (typeof value.message === "string" && value.message) {
    run.message = value.message;
  }

  return run;
}

function encodeRunRow(run: RunRecord) {
  return [run.id, JSON.stringify(run)];
}

function decodeRunRow(row: unknown): RunRecord | null {
  if (!Array.isArray(row) || row.length < 2) return null;
  const raw = row[1];
  if (typeof raw !== "string" || !raw.trim()) return null;

  try {
    return asRunRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

function latestTimestamp(store: StoreShape) {
  let latest = "";

  for (const run of store.runs) {
    const candidate = (run.updatedAt ?? run.createdAt) || "";
    if (candidate > latest) {
      latest = candidate;
    }
  }

  return latest;
}

async function readStoreFromDisk(): Promise<StoreShape> {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape> | null;
    const runs = Array.isArray(parsed?.runs)
      ? parsed.runs.map(asRunRecord).filter((item): item is RunRecord => Boolean(item))
      : [];
    return { version: 1, runs: sortRuns(runs) };
  } catch {
    return createEmptyStore();
  }
}

function getSheetEnvMissingKeys() {
  const env = getEnv();
  const missing: string[] = [];

  if (!env.googleSheetId) missing.push("GOOGLE_SHEET_ID");
  if (!env.googleServiceAccountEmail) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!env.googlePrivateKey) missing.push("GOOGLE_PRIVATE_KEY");

  return missing;
}

async function ensureStateTabExists() {
  const env = getEnv();
  const sheets = getSheetsClient();

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: env.googleSheetId,
    fields: "sheets.properties.sheetId,sheets.properties.title,sheets.properties.hidden",
  });

  const tabs =
    metadata.data.sheets
      ?.map((sheet) => sheet.properties)
      .filter((properties): properties is NonNullable<typeof properties> => Boolean(properties)) ?? [];

  const existing = tabs.find((sheet) => sheet.title === stateTabName);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: env.googleSheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: stateTabName,
                hidden: true,
              },
            },
          },
        ],
      },
    });
    return;
  }

  if (!existing.hidden) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: env.googleSheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: existing.sheetId,
                hidden: true,
              },
              fields: "hidden",
            },
          },
        ],
      },
    });
  }
}

async function readStoreFromSheets(): Promise<StoreShape | null> {
  const missing = getSheetEnvMissingKeys();
  if (missing.length > 0) {
    return null;
  }

  const env = getEnv();
  const sheets = getSheetsClient();

  await ensureStateTabExists();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: env.googleSheetId,
    range: `${quoteSheetTabName(stateTabName)}!A2:B`,
  });

  const rows = response.data.values ?? [];
  const runs = rows.map(decodeRunRow).filter((item): item is RunRecord => Boolean(item));

  return { version: 1, runs: sortRuns(runs) };
}

async function writeStoreToDisk(store: StoreShape) {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function writeStoreToSheets(store: StoreShape) {
  const missing = getSheetEnvMissingKeys();
  if (missing.length > 0) {
    return;
  }

  const env = getEnv();
  const sheets = getSheetsClient();

  await ensureStateTabExists();

  await sheets.spreadsheets.values.clear({
    spreadsheetId: env.googleSheetId,
    range: `${quoteSheetTabName(stateTabName)}!A:Z`,
  });

  const values = [["id", "runJson"], ...store.runs.map(encodeRunRow)];

  await sheets.spreadsheets.values.update({
    spreadsheetId: env.googleSheetId,
    range: `${quoteSheetTabName(stateTabName)}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values,
    },
  });
}

async function loadStore(): Promise<StoreShape> {
  if (storeCache) {
    return storeCache;
  }

  const [diskStore, sheetStore] = await Promise.all([readStoreFromDisk(), readStoreFromSheets()]);

  if (sheetStore && (!diskStore.runs.length || latestTimestamp(sheetStore) >= latestTimestamp(diskStore))) {
    storeCache = sheetStore;
    await writeStoreToDisk(sheetStore).catch(() => {});
    return storeCache;
  }

  storeCache = diskStore;
  if (sheetStore) {
    await writeStoreToSheets(diskStore).catch(() => {});
  }

  return storeCache;
}

async function persistStore(store: StoreShape) {
  const next = {
    version: 1 as const,
    runs: sortRuns(store.runs),
  };

  storeCache = next;

  const persistTask = async () => {
    await writeStoreToDisk(next);
    await writeStoreToSheets(next);
  };

  writeQueue = writeQueue.then(persistTask, persistTask);
  await writeQueue;
}

function findRunIndex(runs: RunRecord[], id: string) {
  return runs.findIndex((run) => run.id === id);
}

export async function listRuns() {
  const store = await loadStore();
  return sortRuns(store.runs);
}

export async function getKnownAmazonShopKeysFromRuns() {
  const store = await loadStore();
  const keys = new Set<string>();

  for (const run of store.runs) {
    for (const candidate of run.discoveredUrls) {
      const dedupeKey = getAmazonShopDedupeKey(candidate);
      if (dedupeKey) {
        keys.add(dedupeKey);
      }
    }

    for (const result of run.results) {
      const dedupeKey = getAmazonShopDedupeKey(result.url);
      if (dedupeKey) {
        keys.add(dedupeKey);
      }
    }
  }

  return keys;
}

export async function getKnownAmazonShopUrlsFromRuns() {
  return getKnownAmazonShopKeysFromRuns();
}

export async function getKeywordDiscoveryRound(keyword: string, currentRunId?: string) {
  const store = await loadStore();
  const normalized = normalizeKeywordKey(keyword);

  return store.runs.filter(
    (run) =>
      run.id !== currentRunId &&
      run.status !== "queued" &&
      run.keywords.some((item) => normalizeKeywordKey(item) === normalized),
  ).length;
}

export async function getRun(id: string) {
  const store = await loadStore();
  return store.runs.find((run) => run.id === id) ?? null;
}

export async function createRun(keywords: string[]) {
  const store = await loadStore();
  const now = new Date().toISOString();
  const record: RunRecord = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "queued",
    keywords,
    discoveredUrls: [],
    results: [],
    searchRounds: {},
  };

  store.runs = [record, ...store.runs];
  await persistStore(store);
  return record;
}

export async function updateRun(
  id: string,
  patch: Partial<Omit<RunRecord, "id" | "createdAt">>,
) {
  const store = await loadStore();
  const index = findRunIndex(store.runs, id);
  if (index === -1) return null;

  const current = store.runs[index];
  const next: RunRecord = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  store.runs[index] = next;
  await persistStore(store);
  return next;
}

export async function setRunResults(
  id: string,
  results: AmazonPageResult[],
  status: RunStatus,
  message?: string,
) {
  return updateRun(id, {
    status,
    results,
    message,
  });
}

export async function resetStore() {
  const store = createEmptyStore();
  await persistStore(store);
  return store;
}
