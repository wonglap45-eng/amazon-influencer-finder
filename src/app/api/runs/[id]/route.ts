import { getRun } from "@/lib/job-store";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const run = getRun(id);

  if (!run) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json({ run });
}

