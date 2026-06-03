export async function GET() {
  return Response.json({
    ok: true,
    service: "amazon-influencer-finder",
    timestamp: new Date().toISOString(),
  });
}

