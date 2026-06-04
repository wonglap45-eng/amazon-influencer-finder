import { spawnSync } from "node:child_process";
import { platform } from "node:process";

const installArgs =
  platform === "linux"
    ? ["playwright", "install", "--with-deps", "chromium"]
    : ["playwright", "install", "chromium"];

const result = spawnSync("npx", installArgs, {
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
