export type RunStatus = "queued" | "running" | "completed" | "failed";

export type PageState = "pending" | "ok" | "blocked" | "error";

export type SocialLinkType =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "facebook"
  | "pinterest"
  | "linktree"
  | "website"
  | "other";

export type SocialLink = {
  type: SocialLinkType;
  url: string;
  platform?: string;
  host?: string;
};

export type DiscoverySummary = {
  discoveredCount: number;
  skippedCount: number;
  roundsByKeyword: Record<string, number>;
  discoveredAt: string;
  roundsCompleted?: number;
};

export type SearchUsageBucket = {
  attemptedRequests: number;
  successfulRequests: number;
  failedRequests: number;
  creditsUsed: number;
};

export type SearchUsage = SearchUsageBucket & {
  provider: "serpapi" | "serper";
  byKeyword: Record<string, SearchUsageBucket>;
  byRound: Record<string, SearchUsageBucket>;
};

export type AmazonPageResult = {
  url: string;
  keyword: string;
  state: PageState;
  blockedReason?: "captcha" | "robot_check" | "access_denied";
  socialLinks: SocialLink[];
  title?: string;
  note?: string;
  attempts?: number;
  lastAttemptAt?: string;
  lastError?: string;
};

export type RunRecord = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  status: RunStatus;
  keywords: string[];
  discoveredUrls: string[];
  results: AmazonPageResult[];
  searchRounds?: Record<string, number>;
  discoverySummary?: DiscoverySummary;
  searchUsage?: SearchUsage;
  message?: string;
};
