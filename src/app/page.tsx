import { RunWorkbench } from "@/components/run-workbench";

export default function Home() {
  return (
    <main className="min-h-screen text-foreground">
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 grid-dots opacity-30" />
        <div className="relative mx-auto w-full max-w-7xl px-6 py-14 lg:px-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-300/10 px-4 py-1 text-sm text-sky-100">
            本地工作台
            <span className="font-mono text-xs text-sky-200/80">
              amazon-influencer-finder
            </span>
          </div>

          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Amazon 达人 / 店铺页面发现器
          </h1>
        </div>
      </section>

      <RunWorkbench />
    </main>
  );
}
