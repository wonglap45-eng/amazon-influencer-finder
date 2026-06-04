import { google } from "googleapis";
import { getEnv, getMissingEnvKeys } from "./config/env";

type SheetsVerifySuccess = {
  ok: true;
  spreadsheetTitle: string | null;
  spreadsheetId: string;
  tabName: string;
  updatedRange: string | null;
};

type SheetsVerifyFailure = {
  ok: false;
  missing: string[];
  error?: string;
  availableTabs?: string[];
};

export type SheetsVerifyResult = SheetsVerifySuccess | SheetsVerifyFailure;

function normalizePrivateKey(raw: string) {
  const trimmed = raw.trim();

  if (!trimmed) return "";

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { private_key?: unknown };
      if (typeof parsed.private_key === "string") {
        return normalizePrivateKey(parsed.private_key);
      }
    } catch {
      // Fall through to text normalization below.
    }
  }

  const unwrapped =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;

  return unwrapped
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
}

function getPrivateKey() {
  const { googlePrivateKey } = getEnv();
  return normalizePrivateKey(googlePrivateKey);
}

export function getSheetsClient() {
  const env = getEnv();

  const auth = new google.auth.JWT({
    email: env.googleServiceAccountEmail,
    key: getPrivateKey(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

export async function verifySheetsConnection(): Promise<SheetsVerifyResult> {
  const env = getEnv();
  const missing = getMissingEnvKeys().filter((key) =>
    ["GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY"].includes(key),
  );

  if (missing.length > 0) {
    return { ok: false as const, missing };
  }

  const sheets = getSheetsClient();
  const privateKey = getPrivateKey();

  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    return {
      ok: false as const,
      missing: [],
      error:
        "GOOGLE_PRIVATE_KEY does not look like a valid PEM private key. Paste the private_key field from the service account JSON.",
    };
  }

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: env.googleSheetId,
    fields: "spreadsheetId,properties.title,sheets.properties.title",
  });

  const availableTabs =
    metadata.data.sheets
      ?.map((sheet) => sheet.properties?.title)
      .filter((title): title is string => Boolean(title)) ?? [];

  if (availableTabs.length === 0) {
    return {
      ok: false as const,
      missing: [],
      availableTabs: [],
      error:
        "Could not read worksheet tabs from the spreadsheet metadata. Double-check the Sheet ID and sharing permissions.",
    };
  }

  const tabName = env.googleSheetTabName || "results";
  if (!availableTabs.includes(tabName)) {
    return {
      ok: false as const,
      missing: [],
      availableTabs,
      error: `Worksheet tab "${tabName}" was not found. Available tabs: ${availableTabs.join(", ")}.`,
    };
  }

  const timestamp = new Date().toISOString();

  const appendResult = await sheets.spreadsheets.values.append({
    spreadsheetId: env.googleSheetId,
    range: `'${tabName}'!A:D`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[timestamp, "connection_test", "ok", env.googleServiceAccountEmail]],
    },
  });

  return {
    ok: true as const,
    spreadsheetTitle: metadata.data.properties?.title ?? null,
    spreadsheetId: metadata.data.spreadsheetId ?? env.googleSheetId,
    tabName,
    updatedRange: appendResult.data.updates?.updatedRange ?? null,
  };
}
