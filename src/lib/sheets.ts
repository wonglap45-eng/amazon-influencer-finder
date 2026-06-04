import { google } from "googleapis";
import { getEnv, getMissingEnvKeys } from "./config/env";

function getPrivateKey() {
  const { googlePrivateKey } = getEnv();
  return googlePrivateKey.replace(/\\n/g, "\n");
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

export async function verifySheetsConnection() {
  const env = getEnv();
  const missing = getMissingEnvKeys().filter((key) =>
    ["GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY"].includes(key),
  );

  if (missing.length > 0) {
    return { ok: false as const, missing };
  }

  const sheets = getSheetsClient();

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: env.googleSheetId,
    fields: "spreadsheetId,properties.title,sheets.properties.title",
  });

  const tabName = env.googleSheetTabName || "results";
  const timestamp = new Date().toISOString();

  const appendResult = await sheets.spreadsheets.values.append({
    spreadsheetId: env.googleSheetId,
    range: `${tabName}!A:D`,
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
