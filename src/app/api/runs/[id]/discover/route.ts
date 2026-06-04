import { getRun, setRunResults, updateRun } from "@/lib/job-store";
import type { AmazonPageResult } from "@/lib/types";
import { discoverAmazonShopUrlsForKeywords } from "@/lib/serpapi/search";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  const run = await getRun(id);

  if (!run) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (!run.keywords.length) {
    return Response.json({ error: "no_keywords" }, { status: 400 });
  }

  try {
    await updateRun(id, {
      status: "running",
      message: "正在使用 SerpAPI 发现 Amazon 店铺页面...",
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
        ? `已发现 ${uniqueUrls.length} 个 Amazon 达人主页候选。`
        : "当前关键词没有找到 Amazon 达人主页候选。";

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
