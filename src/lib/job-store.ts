import { randomUUID } from "node:crypto";
import type { RunRecord } from "./types";

const runs = new Map<string, RunRecord>();

export function createRun(keywords: string[]) {
  const id = randomUUID();
  const record: RunRecord = {
    id,
    createdAt: new Date().toISOString(),
    status: "queued",
    keywords,
    discoveredUrls: [],
    results: [],
  };

  runs.set(id, record);
  return record;
}

export function getRun(id: string) {
  return runs.get(id) ?? null;
}

export function updateRun(id: string, patch: Partial<RunRecord>) {
  const current = runs.get(id);
  if (!current) return null;

  const next = { ...current, ...patch };
  runs.set(id, next);
  return next;
}

export function listRuns() {
  return Array.from(runs.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

