import { google } from "googleapis";
import { getEnv, getMissingEnvKeys } from "./config/env";
import type { AmazonPageResult } from "./types";

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

type SheetCell = string | number | boolean | null;
type SheetRow = SheetCell[];

type SocialColumnBuckets = {
  facebook: string[];
  tiktok: string[];
  instagram: string[];
  youtube: string[];
  pinterest: string[];
  other: string[];
};

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

function quoteSheetTabName(tabName: string) {
  return `'${tabName.replace(/'/g, "''")}'`;
}

function normalizeDisplayText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function slugToDisplayName(slug: string) {
  return slug
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCreatorName(result: AmazonPageResult) {
  const title = normalizeDisplayText(result.title ?? "");
  const amazonPageMatch = title.match(/^(.*?)(?:'s)? Amazon Page$/i);

  if (amazonPageMatch?.[1]) {
    return amazonPageMatch[1].trim();
  }

  const brandMatch = title.match(/^(.+?)(?:\s*\|\s*.+)?$/);
  if (brandMatch?.[1]) {
    return brandMatch[1].trim();
  }

  try {
    const url = new URL(result.url);
    const slug = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (slug) {
      return slugToDisplayName(slug);
    }
  } catch {
    // Fallback below.
  }

  return title || result.keyword;
}

function bucketSocialLinks(result: AmazonPageResult): SocialColumnBuckets {
  const buckets: SocialColumnBuckets = {
    facebook: [],
    tiktok: [],
    instagram: [],
    youtube: [],
    pinterest: [],
    other: [],
  };

  for (const link of result.socialLinks) {
    const platform = (link.platform ?? link.type ?? "").toLowerCase();
    const value = normalizeDisplayText(link.url);

    if (!value) continue;

    if (platform.includes("facebook")) {
      buckets.facebook.push(value);
      continue;
    }

    if (platform.includes("tiktok")) {
      buckets.tiktok.push(value);
      continue;
    }

    if (platform.includes("instagram")) {
      buckets.instagram.push(value);
      continue;
    }

    if (platform.includes("youtube")) {
      buckets.youtube.push(value);
      continue;
    }

    if (platform.includes("pinterest")) {
      buckets.pinterest.push(value);
      continue;
    }

    buckets.other.push(value);
  }

  return buckets;
}

function joinCell(values: string[]) {
  return values.length > 0 ? values.join("\n") : "";
}

function formatBeijingTimestamp(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")} ${valueFor("hour")}:${valueFor("minute")}:${valueFor("second")}`;
}

function buildAmazonResultRows(
  results: AmazonPageResult[],
  syncedAt = formatBeijingTimestamp(new Date()),
): SheetRow[] {
  return results.map((result) => [
    ...(() => {
      const buckets = bucketSocialLinks(result);
      return [
        extractCreatorName(result),
        joinCell(buckets.facebook),
        joinCell(buckets.tiktok),
        joinCell(buckets.instagram),
        joinCell(buckets.youtube),
        joinCell(buckets.pinterest),
        joinCell(buckets.other),
      ];
    })(),
    result.url,
    result.note ?? "",
    syncedAt,
    result.keyword,
  ]);
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
    range: `${quoteSheetTabName(tabName)}!A:D`,
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

export async function appendAmazonResultsToSheet(
  runId: string,
  results: AmazonPageResult[],
) {
  if (!results.length) {
    return { ok: true as const, updatedRange: null, rowCount: 0 };
  }

  const env = getEnv();
  const missing = getMissingEnvKeys().filter((key) =>
    ["GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY"].includes(key),
  );

  if (missing.length > 0) {
    throw new Error(`Missing required Google Sheets env vars: ${missing.join(", ")}`);
  }

  const sheets = getSheetsClient();
  const tabName = env.googleSheetTabName || "results";
  const rows = buildAmazonResultRows(results);

  const appendResult = await sheets.spreadsheets.values.append({
    spreadsheetId: env.googleSheetId,
    range: `${quoteSheetTabName(tabName)}!A:K`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows,
    },
  });

  return {
    ok: true as const,
    updatedRange: appendResult.data.updates?.updatedRange ?? null,
    rowCount: rows.length,
  };
}
