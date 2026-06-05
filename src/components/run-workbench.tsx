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
        setMessage("请至少输入一个关键词。");
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

  async function handleDiscover() {
    if (!activeRunId) {
      setDiscoverMessage("请先创建或选择一个任务。");
      return;
    }

    setDiscoverBusy(true);
    setDiscoverMessage("");

    try {
      const response = await fetch(`/api/runs/${activeRunId}/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        run?: RunRecord;
        discoveredCount?: number;
        provider?: string;
      };

      if (!response.ok || !data.ok || !data.run) {
        setDiscoverMessage(data.error ?? "发现流程失败。");
        return;
      }

      setRuns((current) => [data.run!, ...current.filter((run) => run.id !== data.run!.id)]);
      setDiscoverMessage(
        data.discoveredCount
          ? `${data.provider ?? "当前搜索源"} 发现 ${data.discoveredCount} 个 Amazon 候选页面。`
          : "没有找到 Amazon 候选页面。",
      );
    } catch {
      setDiscoverMessage("发现请求失败。");
    } finally {
      setDiscoverBusy(false);
    }
  }

  async function handleExtract() {
    if (!activeRunId) {
      setExtractMessage("请先创建或选择一个任务。");
      return;
    }

    if (!activeRun?.results.length) {
      setExtractMessage("当前任务还没有可提取的 Amazon 页面，请先点“发现 Amazon 达人主页”。");
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
          setExtractMessage("当前任务已经在提取中，请稍等自动刷新。");
        } else {
          setExtractMessage(data.error ?? "提取社交链接失败。");
        }
        return;
      }

      if (data.run) {
        setRuns((current) => [data.run!, ...current.filter((run) => run.id !== data.run!.id)]);
      }

      setExtractMessage("已开始提取公开社交链接，结果会自动刷新。");
    } catch {
      setExtractMessage("提取社交链接请求失败。");
    } finally {
      setExtractBusy(false);
    }
  }

  const stats = activeRun ? summaryForResults(activeRun.results) : null;
  const keywords = activeRun?.keywords ?? [];

  return (
    <section className="mx-auto w-full max-w-7xl px-6 pb-16 lg:px-10">
      <div className="glass rounded-3xl p-6">
        <div className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">任务工作台</h2>
            <p className="mt-1 text-sm text-slate-400">
              先创建任务，再用当前搜索源发现 Amazon 页面，后续会接入抓取和写表。
            </p>
          </div>
          <div className="text-sm text-slate-300">
            当前共 {runs.length} 个任务{runs.length === 1 ? "" : "s"}
          </div>
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
            <p className="text-xs text-slate-500">
              支持每行一个关键词，也支持逗号分隔。重复项会自动去重。
            </p>
          </label>

          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-medium text-slate-200">接下来会做什么</div>
              <ul className="mt-3 space-y-2 text-sm text-slate-400">
                <li>- 创建任务</li>
                <li>- 用当前搜索源发现 Amazon 达人主页</li>
                <li>- 在本地保存候选 URL</li>
                <li>- 为后续 Playwright 抓取做准备</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
              <div className="text-sm font-medium text-emerald-100">Google Sheets 检查</div>
              <p className="mt-2 text-sm text-emerald-50/80">
                用来验证 Sheet ID、服务账号邮箱、私钥和写入权限。
              </p>
              <button
                type="button"
                onClick={() => void handleSheetCheck()}
                disabled={sheetCheckBusy}
                className="mt-4 rounded-2xl bg-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sheetCheckBusy ? "检查中..." : "验证 Google Sheets"}
              </button>
              <p className="mt-3 text-xs leading-5 text-emerald-50/80">
                {sheetCheckMessage || "点击后会向你的标签页写入一行测试数据。"}
              </p>
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
              disabled={discoverBusy || !activeRunId}
              className="rounded-2xl border border-sky-300/30 bg-sky-300/10 px-5 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {discoverBusy ? "发现中..." : "发现 Amazon 达人主页"}
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
                还没有任务，先在上面创建一个。
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
              选择一个任务即可查看详情。
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

              {activeRun.message ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                  <div className="text-xs uppercase tracking-wide text-slate-500">后端消息</div>
                  <p className="mt-2 break-words">{activeRun.message}</p>
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
                          还没有提取结果，这在接入 Playwright 之前是正常的。
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
