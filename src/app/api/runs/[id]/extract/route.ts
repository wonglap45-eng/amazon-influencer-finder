import { extractAmazonSocialLinksForRun } from "@/lib/amazon/run-extractor";
import { getRun, updateRun } from "@/lib/job-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const activeExtractionJobs = new Set<string>();

function isExtractionInProgress(message?: string | null) {
  return Boolean(message && message.includes("公开社交链接"));
}

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  const run = await getRun(id);

  if (!run) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  if (activeExtractionJobs.has(id) || isExtractionInProgress(run.message)) {
    return Response.json({ ok: false, error: "extracting" }, { status: 409 });
  }

  activeExtractionJobs.add(id);

  void extractAmazonSocialLinksForRun(id)
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : "unknown_error";
      await updateRun(id, {
        status: "failed",
        message,
      });
    })
    .finally(() => {
      activeExtractionJobs.delete(id);
    });

  await updateRun(id, {
    status: "running",
    message: "已开始提取公开社交链接，页面会自动刷新显示结果。",
  });

  const refreshed = await getRun(id);
  return Response.json({
    ok: true,
    run: refreshed,
  });
}
