export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export function randomDelayMs(minMs: number, maxMs: number) {
  const lower = Number.isFinite(minMs) ? Math.max(0, Math.floor(minMs)) : 0;
  const upper = Number.isFinite(maxMs) ? Math.max(lower, Math.floor(maxMs)) : lower;
  const span = Math.max(0, upper - lower);

  return lower + Math.floor(Math.random() * (span + 1));
}
