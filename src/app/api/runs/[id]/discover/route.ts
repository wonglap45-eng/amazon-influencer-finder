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
      message: "Discovering Amazon storefronts with SerpAPI...",
    });

    const { discovered, uniqueUrls } = await discoverAmazonShopUrlsForKeywords(run.keywords);

    const results: AmazonPageResult[] = uniqueUrls.map(({ url, keyword }) => ({
      url,
      keyword,
      state: "pending",
      socialLinks: [],
      note: "Discovered via SerpAPI. Ready for Playwright extraction.",
    }));

    const message =
      uniqueUrls.length > 0
        ? `Discovered ${uniqueUrls.length} Amazon storefront candidate${uniqueUrls.length === 1 ? "" : "s"}.`
        : "No Amazon storefront pages were found from the current keyword set.";

    const nextRun = await setRunResults(id, results, "running", message);
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
