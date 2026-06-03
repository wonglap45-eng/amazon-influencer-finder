const phases = [
  {
    title: "1. Input keywords",
    description:
      "Accept multi-line keywords, clean duplicates, and create a run.",
  },
  {
    title: "2. SerpAPI search",
    description:
      "Use SerpAPI only, then filter results for amazon.com/shop/xxx pages.",
  },
  {
    title: "3. Playwright extraction",
    description:
      "Open public pages, detect blocked states, and extract public social links.",
  },
  {
    title: "4. Google Sheets sync",
    description:
      "Append results to Sheets and show live run status in the UI.",
  },
];

const rules = [
  "Do not log in to Amazon",
  "Do not bypass CAPTCHA / Robot Check / Access Denied",
  "Do not use proxy pools",
  "Only collect information shown on public pages",
  "Wait 5-10 seconds between Amazon pages",
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
                Local workspace
                <span className="font-mono text-xs text-sky-200/80">
                  amazon-influencer-finder
                </span>
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                Amazon Influencer / Storefront Finder
              </h1>
              <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                A local, layered build for keyword input, SerpAPI discovery, public-page
                extraction, Google Sheets sync, and result display.
              </p>
            </div>

            <div className="glass w-full max-w-md rounded-3xl p-5 shadow-2xl shadow-sky-950/20">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Implementation status</span>
                <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs text-emerald-300">
                  scaffold ready
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
              <h2 className="text-2xl font-semibold">Execution flow</h2>
              <p className="mt-1 text-sm text-slate-400">
                This page is a scaffold for now. The next step is wiring the real run
                execution.
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
            <h2 className="text-xl font-semibold">Next step</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              The best next move is to add the smallest possible run lifecycle:
              submit keywords, create a run, and poll status.
            </p>
            <div className="mt-5 rounded-2xl border border-sky-300/20 bg-sky-300/8 p-4 text-sm text-sky-50">
              Once that is in place, we can add SerpAPI, Playwright, and Google Sheets
              one layer at a time.
            </div>
          </div>

          <div className="glass rounded-3xl p-6">
            <h2 className="text-xl font-semibold">Planned modules</h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-300">
              <li>- `lib/serpapi/search.ts`</li>
              <li>- `lib/amazon/playwright-scraper.ts`</li>
              <li>- `lib/sheets/google-sheets.ts`</li>
              <li>- `scripts/worker.ts`</li>
            </ul>
          </div>
        </aside>
      </section>
    </main>
  );
}
