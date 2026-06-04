import { getEnv } from "@/lib/config/env";
import { verifySheetsConnection } from "@/lib/sheets";

export async function GET() {
  const env = getEnv();
  return Response.json({
    ok: true,
    configured: {
      hasSheetId: Boolean(env.googleSheetId),
      hasServiceAccountEmail: Boolean(env.googleServiceAccountEmail),
      hasPrivateKey: Boolean(env.googlePrivateKey),
      tabName: env.googleSheetTabName,
    },
    hint: "Send a POST request to append a connection test row.",
  });
}

export async function POST() {
  try {
    const result = await verifySheetsConnection();

    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          error: result.error ?? "missing_env",
          missing: result.missing,
        },
        { status: 400 },
      );
    }

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return Response.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
