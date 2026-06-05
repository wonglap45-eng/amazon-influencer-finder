import { getEnv } from "@/lib/config/env";
import { getRun, setRunResults, updateRun } from "@/lib/job-store";
import type { AmazonPageResult } from "@/lib/types";
import { discoverAmazonShopUrlsForKeywords } from "@/lib/search/discover";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  const run = await getRun(id);
  const env = getEnv();
  const provider = env.searchProvider === "serper" ? "Serper" : "SerpAPI";

  if (!run) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (!run.keywords.length) {
    return Response.json({ error: "no_keywords" }, { status: 400 });
  }

  try {
    await updateRun(id, {
      status: "running",
      message: `正在使用 ${provider} 发现 Amazon 店铺页面...`,
    });

    const { discovered, uniqueUrls } = await discoverAmazonShopUrlsForKeywords(run.keywords);

    const results: AmazonPageResult[] = uniqueUrls.map(({ url, keyword }) => ({
      url,
      keyword,
      state: "pending",
      socialLinks: [],
      note: "已归一化为达人主页，等待 Playwright 提取。",
    }));

    const discoveredUrls = uniqueUrls.map((item) => item.url);
    const message =
      uniqueUrls.length > 0
        ? `${provider} 已发现 ${uniqueUrls.length} 个 Amazon 达人主页候选。`
        : `${provider} 没有找到 Amazon 达人主页候选。`;

    const nextRun = await setRunResults(id, results, "running", message);
    await updateRun(id, {
      discoveredUrls,
    });

    const refreshedRun = nextRun ?? (await getRun(id));

    return Response.json({
      ok: true,
      run: refreshedRun,
      discovery: discovered,
      discoveredCount: uniqueUrls.length,
      provider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";

    await updateRun(id, {
      status: "failed",
      message,
    });

    return Response.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
