import { RunWorkbench } from "@/components/run-workbench";

const phases = [
  {
    title: "1. 输入关键词",
    description: "支持多行关键词输入，自动去重并创建一次任务。",
  },
  {
    title: "2. SerpAPI 搜索",
    description: "仅通过 SerpAPI 搜索 Google，再筛出 amazon.com/shop/xxx 页面。",
  },
  {
    title: "3. Playwright 提取",
    description: "打开公开页面，识别阻断状态，并提取公开社交链接。",
  },
  {
    title: "4. Google Sheets 同步",
    description: "把结果追加到表格，同时在页面里展示任务状态。",
  },
];

const rules = [
  "不登录 Amazon",
  "不绕过 CAPTCHA / Robot Check / Access Denied",
  "不使用代理池",
  "只采集公开页面已展示的信息",
  "每个 Amazon 页面之间随机等待 5-10 秒",
];

export default function Home() {
  return (
    <main className="min-h-screen text-foreground">
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 grid-dots opacity-30" />
        <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 py-14 lg:px-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-300/10 px-4 py-1 text-sm text-sky-100">
                本地工作台
                <span className="font-mono text-xs text-sky-200/80">
                  amazon-influencer-finder
                </span>
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                Amazon 达人 / 店铺页面发现器
              </h1>
              <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                这是一个本地分层构建的工作台：输入关键词、通过 SerpAPI 发现页面、
                提取公开链接、同步到 Google Sheets，并在界面中展示结果。
              </p>
            </div>

            <div className="glass w-full max-w-md rounded-3xl p-5 shadow-2xl shadow-sky-950/20">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">当前状态</span>
                <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs text-emerald-300">
                  骨架已就绪
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {rules.map((rule) => (
                  <div
                    key={rule}
                    className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-200"
                  >
                    {rule}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-6 py-10 lg:grid-cols-[1.25fr_0.75fr] lg:px-10">
        <div className="glass rounded-3xl p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">执行流程</h2>
              <p className="mt-1 text-sm text-slate-400">
                先把任务闭环跑通，后面再逐层接入抓取和写表能力。
              </p>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-xs text-slate-300">
              /api/runs
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {phases.map((phase) => (
              <article
                key={phase.title}
                className="rounded-2xl border border-white/8 bg-black/20 p-5"
              >
                <h3 className="text-lg font-medium text-sky-100">{phase.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {phase.description}
                </p>
              </article>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="glass rounded-3xl p-6">
            <h2 className="text-xl font-semibold">下一步</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              先完成最小可用任务流：提交关键词、创建任务、轮询状态。
            </p>
            <div className="mt-5 rounded-2xl border border-sky-300/20 bg-sky-300/8 p-4 text-sm text-sky-50">
              当这层稳定后，就可以继续接 SerpAPI、Playwright 和 Google Sheets。
            </div>
          </div>

          <div className="glass rounded-3xl p-6">
            <h2 className="text-xl font-semibold">计划模块</h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-300">
              <li>- `lib/serpapi/search.ts`</li>
              <li>- `lib/amazon/playwright-scraper.ts`</li>
              <li>- `lib/sheets/google-sheets.ts`</li>
              <li>- `scripts/worker.ts`</li>
            </ul>
          </div>
        </aside>
      </section>

      <RunWorkbench />
    </main>
  );
}
