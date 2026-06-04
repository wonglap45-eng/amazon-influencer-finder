export type BlockReason = "captcha" | "robot_check" | "access_denied";

type BlockSignal = {
  title?: string;
  text?: string;
  url?: string;
};

const BLOCK_PATTERNS: Array<{ reason: BlockReason; patterns: RegExp[] }> = [
  {
    reason: "captcha",
    patterns: [
      /captcha/i,
      /are you a robot/i,
      /enter the characters/i,
      /security check/i,
      /verify you are human/i,
    ],
  },
  {
    reason: "robot_check",
    patterns: [/robot check/i, /robot verification/i, /please confirm you are not a robot/i],
  },
  {
    reason: "access_denied",
    patterns: [
      /access denied/i,
      /request blocked/i,
      /forbidden/i,
      /pardon our interruption/i,
      /sorry, something went wrong/i,
    ],
  },
];

export function detectBlockReason(signal: BlockSignal): BlockReason | null {
  const haystack = [signal.title, signal.text, signal.url]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  for (const rule of BLOCK_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return rule.reason;
    }
  }

  return null;
}

export function blockReasonLabel(reason: BlockReason) {
  switch (reason) {
    case "captcha":
      return "CAPTCHA";
    case "robot_check":
      return "Robot Check";
    case "access_denied":
      return "Access Denied";
  }
}
