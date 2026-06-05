import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AmazonPageResult, RunRecord, RunStatus } from "./types";
import { normalizeAmazonShopUrl } from "./amazon/url-normalizer";
import { normalizeKeywordKey } from "./search/keyword";

type StoreShape = {
  runs: RunRecord[];
};

const storePath = join(process.cwd(), "data", "jobs.json");

let storeCache: StoreShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function createEmptyStore(): StoreShape {
  return { runs: [] };
}

async function readStoreFromDisk(): Promise<StoreShape> {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape> | null;
    const runs = Array.isArray(parsed?.runs) ? parsed.runs : [];
    return { runs: runs.filter(Boolean) as RunRecord[] };
  } catch {
    return createEmptyStore();
  }
}

async function loadStore(): Promise<StoreShape> {
  if (!storeCache) {
    storeCache = await readStoreFromDisk();
  }
  return storeCache;
}

async function persistStore(store: StoreShape) {
  storeCache = store;
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(storePath), { recursive: true });
    await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  });
  await writeQueue;
}

function sortRuns(runs: RunRecord[]) {
  return [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listRuns() {
  const store = await loadStore();
  return sortRuns(store.runs);
}

export async function getKnownAmazonShopUrlsFromRuns() {
  const store = await loadStore();
  const urls = new Set<string>();

  for (const run of store.runs) {
    for (const candidate of run.discoveredUrls) {
      const normalized = normalizeAmazonShopUrl(candidate);
      if (normalized) {
        urls.add(normalized);
      }
    }

    for (const result of run.results) {
      const normalized = normalizeAmazonShopUrl(result.url);
      if (normalized) {
        urls.add(normalized);
      }
    }
  }

  return urls;
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
  const record: RunRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
  const index = store.runs.findIndex((run) => run.id === id);
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
