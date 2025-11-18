#!/usr/bin/env node
import { spawn } from "node:child_process";

const cliArgs = process.argv.slice(2);

const runner = spawn(
  "pnpm",
  ["exec", "vitest", "run", ...cliArgs],
  {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  },
);

runner.on("close", (code) => {
  process.exit(code ?? 0);
});

runner.on("error", (error) => {
  console.error("Failed to launch vitest:", error);
  process.exit(1);
});
