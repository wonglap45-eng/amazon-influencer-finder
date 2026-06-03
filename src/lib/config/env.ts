type EnvShape = {
  SERPAPI_KEY?: string;
  GOOGLE_SHEET_ID?: string;
  GOOGLE_SHEETS_TAB_NAME?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  APP_BASE_URL?: string;
  PLAYWRIGHT_HEADLESS?: string;
  MIN_DELAY_MS?: string;
  MAX_DELAY_MS?: string;
};

function readEnv(): EnvShape {
  return process.env as EnvShape;
}

export function getEnv() {
  const env = readEnv();

  return {
    serpapiKey: env.SERPAPI_KEY ?? "",
    googleSheetId: env.GOOGLE_SHEET_ID ?? "",
    googleSheetTabName: env.GOOGLE_SHEETS_TAB_NAME ?? "results",
    googleServiceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "",
    googlePrivateKey: env.GOOGLE_PRIVATE_KEY ?? "",
    appBaseUrl: env.APP_BASE_URL ?? "http://localhost:3000",
    playwrightHeadless: env.PLAYWRIGHT_HEADLESS !== "false",
    minDelayMs: Number(env.MIN_DELAY_MS ?? 5000),
    maxDelayMs: Number(env.MAX_DELAY_MS ?? 10000),
  };
}

export function getMissingEnvKeys() {
  const env = getEnv();
  const missing: string[] = [];

  if (!env.serpapiKey) missing.push("SERPAPI_KEY");
  if (!env.googleSheetId) missing.push("GOOGLE_SHEET_ID");
  if (!env.googleServiceAccountEmail) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!env.googlePrivateKey) missing.push("GOOGLE_PRIVATE_KEY");

  return missing;
}

