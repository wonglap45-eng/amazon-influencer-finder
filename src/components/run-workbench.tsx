/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { AmazonPageResult, RunRecord } from "@/lib/types";

function parseKeywords(raw: string) {
  return Array.from(
    new Set(
      raw
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function linkLabel(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function summaryForResults(results: AmazonPageResult[]) {
  const summary = {
    ok: 0,
    blocked: 0,
    error: 0,
    pending: 0,
  };

  for (const result of results) {
    summary[result.state] += 1;
  }

  return summary;
}

export function RunWorkbench() {
  const [keywordsText, setKeywordsText] = useState(
    ["cleaning", "home cleaning", "pet supplies", "bathroom cleaning", "kitchen gadgets"].join("\n"),
  );
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [activeRunId, setActiveRunId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [sheetCheckBusy, setSheetCheckBusy] = useState(false);
  const [sheetCheckMessage, setSheetCheckMessage] = useState<string>("");

  const activeRun = useMemo(
    () => runs.find((run) => run.id === activeRunId) ?? null,
    [runs, activeRunId],
  );

  const refreshRuns = useCallback(async () => {
    const response = await fetch("/api/runs", { cache: "no-store" });
    const data = (await response.json()) as { runs: RunRecord[] };
    setRuns(data.runs ?? []);
  }, []);

  const refreshActiveRun = useCallback(async (runId: string) => {
    const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    if (!response.ok) return;

    const data = (await response.json()) as { run: RunRecord };
    setRuns((current) => {
      const next = current.filter((run) => run.id !== data.run.id);
      return [data.run, ...next];
    });
  }, []);

  useEffect(() => {
    void refreshRuns().catch(() => {
      setMessage("Failed to load existing runs.");
    });
  }, [refreshRuns]);

  useEffect(() => {
    if (!activeRunId) return;

    const timer = window.setInterval(() => {
      void refreshActiveRun(activeRunId).catch(() => {});
    }, 3000);

    void refreshActiveRun(activeRunId).catch(() => {});

    return () => window.clearInterval(timer);
  }, [activeRunId, refreshActiveRun]);

  useEffect(() => {
    if (!activeRunId && runs.length) {
      setActiveRunId(runs[0].id);
    }
  }, [activeRunId, runs]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const keywords = parseKeywords(keywordsText);
      if (!keywords.length) {
        setMessage("Enter at least one keyword.");
        return;
      }

      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords }),
      });

      const data = (await response.json()) as { run?: RunRecord; error?: string };
      if (!response.ok || !data.run) {
        setMessage(data.error ?? "Failed to create run.");
        return;
      }

      setRuns((current) => [data.run!, ...current.filter((run) => run.id !== data.run!.id)]);
      setActiveRunId(data.run.id);
      setMessage(`Run ${data.run.id.slice(0, 8)} created.`);
    } catch {
      setMessage("Something went wrong creating the run.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSheetCheck() {
    setSheetCheckBusy(true);
    setSheetCheckMessage("");

    try {
      const response = await fetch("/api/verify/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSheetCheckMessage(
          data.missing?.length
            ? `Missing: ${data.missing.join(", ")}`
            : data.error ?? "Sheets verification failed.",
        );
        return;
      }

      setSheetCheckMessage(
        `Connected. Wrote test row to ${data.tabName} in ${data.spreadsheetTitle ?? "sheet"}.`,
      );
    } catch {
      setSheetCheckMessage("Sheets verification request failed.");
    } finally {
      setSheetCheckBusy(false);
    }
  }

  const stats = activeRun ? summaryForResults(activeRun.results) : null;
  const keywords = activeRun?.keywords ?? [];

  return (
    <section className="mx-auto w-full max-w-7xl px-6 pb-16 lg:px-10">
      <div className="glass rounded-3xl p-6">
        <div className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Run workbench</h2>
            <p className="mt-1 text-sm text-slate-400">
              Submit keywords now. The actual search and extraction layers will be
              plugged in next.
            </p>
          </div>
          <div className="text-sm text-slate-300">
            {runs.length} stored run{runs.length === 1 ? "" : "s"}
          </div>
        </div>

        <form className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-3">
            <span className="text-sm font-medium text-slate-200">Keywords</span>
            <textarea
              value={keywordsText}
              onChange={(event) => setKeywordsText(event.target.value)}
              rows={10}
              className="min-h-56 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-300/50 focus:ring-2 focus:ring-sky-300/20"
              placeholder={"cleaning\nhome cleaning\npet supplies"}
            />
            <p className="text-xs text-slate-500">
              One keyword per line or comma-separated. Duplicates are removed automatically.
            </p>
          </label>

          <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-medium text-slate-200">What happens next</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li>- create a run</li>
              <li>- persist it locally</li>
              <li>- show it in the dashboard</li>
              <li>- keep the UI ready for worker updates</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <div className="text-sm font-medium text-emerald-100">Google Sheets check</div>
            <p className="mt-2 text-sm text-emerald-50/80">
              Use this to verify your Sheet ID, service account email, private key, and
              write permissions.
            </p>
            <button
              type="button"
              onClick={() => void handleSheetCheck()}
              disabled={sheetCheckBusy}
              className="mt-4 rounded-2xl bg-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sheetCheckBusy ? "Checking..." : "Verify Google Sheets"}
            </button>
            <p className="mt-3 text-xs leading-5 text-emerald-50/80">
              {sheetCheckMessage || "This will append one test row to your tab."}
            </p>
          </div>
          <button
            type="submit"
            disabled={busy}
              className="rounded-2xl bg-sky-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Creating run..." : "Create run"}
            </button>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <div className="font-medium text-slate-100">Status</div>
              <p className="mt-2">{message || "Ready."}</p>
            </div>
          </div>
        </form>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="glass rounded-3xl p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Recent runs</h3>
            <button
              type="button"
              onClick={() => void refreshRuns()}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 transition hover:bg-white/10"
            >
              Refresh
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {runs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-500">
                No runs yet. Create your first one above.
              </div>
            ) : (
              runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setActiveRunId(run.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    run.id === activeRunId
                      ? "border-sky-300/40 bg-sky-300/10"
                      : "border-white/10 bg-black/20 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-slate-100">
                      {run.keywords.length} keyword{run.keywords.length === 1 ? "" : "s"}
                    </div>
                    <div className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-400">
                      {run.status}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {new Date(run.createdAt).toLocaleString()}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {run.keywords.slice(0, 4).map((keyword) => (
                      <span
                        key={keyword}
                        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="glass rounded-3xl p-6">
          {!activeRun ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-8 text-center text-slate-500">
              Select a run to see details.
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-sm text-slate-400">Active run</div>
                  <h3 className="mt-1 text-2xl font-semibold">
                    {activeRun.id.slice(0, 8)}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Created {new Date(activeRun.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
                  <div className="text-slate-400">Status</div>
                  <div className="mt-1 font-semibold text-sky-100">{activeRun.status}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Updated{" "}
                    {new Date(activeRun.updatedAt ?? activeRun.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-xs text-sky-100"
                  >
                    {keyword}
                  </span>
                ))}
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-4">
                {stats &&
                  ([
                    ["OK", stats.ok],
                    ["Blocked", stats.blocked],
                    ["Error", stats.error],
                    ["Pending", stats.pending],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
                    </div>
                  ))}
              </div>

              <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-white/5 text-slate-300">
                    <tr>
                      <th className="px-4 py-3 font-medium">Amazon page</th>
                      <th className="px-4 py-3 font-medium">State</th>
                      <th className="px-4 py-3 font-medium">Social links</th>
                      <th className="px-4 py-3 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRun.results.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-slate-500" colSpan={4}>
                          No extraction results yet. This is expected until the worker layer
                          is added.
                        </td>
                      </tr>
                    ) : (
                      activeRun.results.map((result) => (
                        <tr key={result.url} className="border-t border-white/10">
                          <td className="px-4 py-4 align-top">
                            <div className="font-medium text-slate-100">{linkLabel(result.url)}</div>
                            <div className="mt-1 break-all font-mono text-xs text-slate-500">
                              {result.url}
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200">
                              {result.state}
                            </span>
                            {result.blockedReason ? (
                              <div className="mt-2 text-xs text-amber-300">
                                {result.blockedReason}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-4 align-top text-slate-300">
                            {result.socialLinks.length === 0 ? (
                              <span className="text-slate-500">None</span>
                            ) : (
                              <div className="flex flex-col gap-2">
                                {result.socialLinks.map((item) => (
                                  <a
                                    key={`${result.url}-${item.type}-${item.url}`}
                                    href={item.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sky-200 hover:underline"
                                  >
                                    {item.type}
                                  </a>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-4 align-top text-slate-400">
                            {result.note || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
