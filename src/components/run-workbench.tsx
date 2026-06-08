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

function platformCountForLinks(links: AmazonPageResult["socialLinks"]) {
  return new Set(
    links.map((item) => item.platform ?? item.type ?? item.host ?? "website"),
  ).size;
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
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverMessage, setDiscoverMessage] = useState<string>("");
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractMessage, setExtractMessage] = useState<string>("");

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
      setMessage("加载已有任务失败。");
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
        setMessage("请先输入关键词。");
        return;
      }

      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords }),
      });

      const data = (await response.json()) as { run?: RunRecord; error?: string };
      if (!response.ok || !data.run) {
        setMessage(data.error ?? "创建任务失败。");
        return;
      }

      setRuns((current) => [data.run!, ...current.filter((run) => run.id !== data.run!.id)]);
      setActiveRunId(data.run.id);
      setMessage(`已创建任务 ${data.run.id.slice(0, 8)}。`);
    } catch {
      setMessage("创建任务时出错。");
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
            ? `缺少变量：${data.missing.join(", ")}`
            : data.availableTabs?.length
              ? `${data.error ?? "Google Sheets 验证失败。"} 可用标签：${data.availableTabs.join(", ")}。`
              : data.error ?? "Google Sheets 验证失败。",
        );
        return;
      }

      setSheetCheckMessage(
        `连接成功。已向 ${data.spreadsheetTitle ?? "表格"} 的 ${data.tabName} 写入测试行。`,
      );
    } catch {
      setSheetCheckMessage("Google Sheets 验证请求失败。");
    } finally {
      setSheetCheckBusy(false);
    }
  }

  async function handleDiscover(action?: "continue_current" | "next_keyword") {
    if (!activeRunId) {
      setDiscoverMessage("未选择任务。");
      return;
    }

    if (discoveryPromptReady && !action) {
      setDiscoverMessage("请先选择继续当前关键词，或者切换到下一个关键词。");
      return;
    }

    setDiscoverBusy(true);
    setDiscoverMessage("");

    try {
      const response = await fetch(`/api/runs/${activeRunId}/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action ? JSON.stringify({ action }) : undefined,
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        run?: RunRecord;
        discoveredCount?: number;
        skippedCount?: number;
        message?: string;
      };

      if (!response.ok || !data.ok || !data.run) {
        setDiscoverMessage(data.error ?? "发现失败。");
        return;
      }

      setRuns((current) => [data.run!, ...current.filter((run) => run.id !== data.run!.id)]);
      setDiscoverMessage(
        data.message ??
          (data.discoveredCount
            ? `发现 ${data.discoveredCount} 个候选页面。`
            : "没有找到新的候选页面。"),
      );
    } catch {
      setDiscoverMessage("发现请求失败。");
    } finally {
      setDiscoverBusy(false);
    }
  }

  async function handleExtract() {
    if (!activeRunId) {
      setExtractMessage("未选择任务。");
      return;
    }

    if (!activeRun?.results.length) {
      setExtractMessage("暂无可提取页面。");
      return;
    }

    setExtractBusy(true);
    setExtractMessage("");

    try {
      const response = await fetch(`/api/runs/${activeRunId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        run?: RunRecord;
      };

      if (!response.ok || !data.ok) {
        if (data.error === "extracting") {
          setExtractMessage("提取中，请稍等。");
        } else {
          setExtractMessage(data.error ?? "提取社交链接失败。");
        }
        return;
      }

      if (data.run) {
        setRuns((current) => [data.run!, ...current.filter((run) => run.id !== data.run!.id)]);
      }

      setExtractMessage("已开始处理，结果会自动刷新。");
    } catch {
      setExtractMessage("提取社交链接请求失败。");
    } finally {
      setExtractBusy(false);
    }
  }

  const stats = activeRun ? summaryForResults(activeRun.results) : null;
  const keywords = activeRun?.keywords ?? [];
  const discoverySummary = activeRun?.discoverySummary ?? null;
  const searchUsage = activeRun?.searchUsage ?? null;
  const hasPendingResults = (stats?.pending ?? 0) > 0;
  const discoveryPromptReady = Boolean(discoverySummary?.awaitingDecision && !hasPendingResults);
  const searchUsageLabel = "消费额度";

  return (
    <section className="mx-auto w-full max-w-7xl px-6 pb-16 lg:px-10">
      <div className="glass rounded-3xl p-6">
        <div className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">任务工作台</h2>
          </div>
          <div className="text-sm text-slate-300">当前共 {runs.length} 个任务</div>
        </div>

        <form className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-3">
            <span className="text-sm font-medium text-slate-200">关键词</span>
            <textarea
              value={keywordsText}
              onChange={(event) => setKeywordsText(event.target.value)}
              rows={10}
              className="min-h-56 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-300/50 focus:ring-2 focus:ring-sky-300/20"
              placeholder={"cleaning\nhome cleaning\npet supplies"}
            />
          </label>

          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
              <div className="text-sm font-medium text-emerald-100">Google Sheets 检查</div>
              <button
                type="button"
                onClick={() => void handleSheetCheck()}
                disabled={sheetCheckBusy}
                className="mt-4 rounded-2xl bg-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sheetCheckBusy ? "检查中..." : "验证 Google Sheets"}
              </button>
              {sheetCheckMessage ? (
                <p className="mt-3 text-xs leading-5 text-emerald-50/80">{sheetCheckMessage}</p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={busy}
              className="rounded-2xl bg-sky-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "创建中..." : "创建任务"}
            </button>

            <button
              type="button"
              onClick={() => void handleDiscover()}
              disabled={discoverBusy || !activeRunId || discoveryPromptReady}
              className="rounded-2xl border border-sky-300/30 bg-sky-300/10 px-5 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {discoverBusy
                ? "发现中..."
                : discoveryPromptReady
                  ? "请先选择下一步"
                  : "发现下一批 30 个"}
            </button>

            <button
              type="button"
              onClick={() => void handleExtract()}
              disabled={extractBusy || !activeRunId}
              className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-5 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {extractBusy ? "提取中..." : "提取社交链接"}
            </button>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <div className="font-medium text-slate-100">状态</div>
              <p className="mt-2">{message || "就绪。"}</p>
              {discoverMessage ? <p className="mt-2 text-sky-100">{discoverMessage}</p> : null}
              {extractMessage ? <p className="mt-2 text-emerald-100">{extractMessage}</p> : null}
            </div>
          </div>
        </form>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="glass rounded-3xl p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">最近任务</h3>
            <button
              type="button"
              onClick={() => void refreshRuns()}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 transition hover:bg-white/10"
            >
              刷新
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {runs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-500">
                暂无任务。
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
                      {run.keywords.length} 个关键词
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
              请选择任务。
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-sm text-slate-400">当前任务</div>
                  <h3 className="mt-1 text-2xl font-semibold">
                    {activeRun.id.slice(0, 8)}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    创建于 {new Date(activeRun.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
                  <div className="text-slate-400">状态</div>
                  <div className="mt-1 font-semibold text-sky-100">{activeRun.status}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    更新于 {new Date(activeRun.updatedAt ?? activeRun.createdAt).toLocaleString()}
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
                    ["成功", stats.ok],
                    ["阻断", stats.blocked],
                    ["错误", stats.error],
                    ["待处理", stats.pending],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
                    </div>
                  ))}
              </div>

              {searchUsage ? (
                <div
                  className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4"
                  title={searchUsageLabel}
                >
                  <div className="text-xs uppercase tracking-wide text-amber-100/70">
                    消费额度
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-4">
                    {([
                      ["总消耗", searchUsage.creditsUsed],
                      ["请求次数", searchUsage.attemptedRequests],
                      ["成功次数", searchUsage.successfulRequests],
                      ["失败次数", searchUsage.failedRequests],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
                        <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {Object.entries(searchUsage.byKeyword).map(([keyword, bucket]) => (
                      <span
                        key={keyword}
                        className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-200"
                        title={`${keyword} -> ${bucket.creditsUsed} credits`}
                      >
                        {keyword}: {bucket.creditsUsed}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {discoveryPromptReady && discoverySummary ? (
                <div className="mt-4 rounded-2xl border border-sky-300/20 bg-sky-300/10 p-4">
                  <div className="text-sm font-semibold text-sky-100">下一步</div>
                  <div className="mt-1 text-xs text-slate-300">
                    当前关键词：{discoverySummary.activeKeyword ?? keywords[0] ?? ""}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    本批已发现 {discoverySummary.batchCount ?? discoverySummary.discoveredCount} /{" "}
                    {discoverySummary.batchLimit ?? 30} 个候选
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void handleDiscover("continue_current")}
                      disabled={discoverBusy || discoverySummary.canContinueCurrent === false}
                      className="rounded-2xl bg-sky-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      继续当前关键词
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDiscover("next_keyword")}
                      disabled={discoverBusy || discoverySummary.canSwitchNext === false}
                      className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      换下一个关键词
                    </button>
                  </div>
                </div>
              ) : null}

              {discoverySummary ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">本次新增</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-100">
                      {discoverySummary.discoveredCount}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      新发现的 Amazon 达人主页候选
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">跳过旧链接</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-100">
                      {discoverySummary.skippedCount}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      历史里已经收录过的候选
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-white/5 text-slate-300">
                    <tr>
                      <th className="px-4 py-3 font-medium">达人主页</th>
                      <th className="px-4 py-3 font-medium">状态</th>
                      <th className="px-4 py-3 font-medium">社交链接</th>
                      <th className="px-4 py-3 font-medium">平台数</th>
                      <th className="px-4 py-3 font-medium">备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRun.results.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-slate-500" colSpan={5}>
                          暂无结果。
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
                              <span className="text-slate-500">无</span>
                            ) : (
                              <div className="flex flex-col gap-2">
                                {result.socialLinks.map((item) => (
                                  <a
                                    key={`${result.url}-${item.url}`}
                                    href={item.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sky-200 hover:underline"
                                  >
                                    {item.platform ?? item.type}
                                  </a>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-4 align-top text-slate-300">
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200">
                              {platformCountForLinks(result.socialLinks)} 个
                            </span>
                          </td>
                          <td className="px-4 py-4 align-top text-slate-400">
                            {result.state === "pending"
                              ? "待处理"
                              : result.state === "ok"
                                ? "完成"
                                : result.state === "blocked"
                                  ? "已阻断"
                                  : "错误"}
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
