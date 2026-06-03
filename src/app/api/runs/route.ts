import { createRun, listRuns } from "@/lib/job-store";

function parseKeywords(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

export async function GET() {
  const runs = await listRuns();
  return Response.json({ runs });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { keywords?: unknown } | null;
  const keywords = parseKeywords(body?.keywords);

  if (!keywords.length) {
    return Response.json({ error: "keywords_required" }, { status: 400 });
  }

  const run = await createRun(keywords);

  return Response.json({ run });
}
