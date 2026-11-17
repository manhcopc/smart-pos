import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function loadEnvFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const [, , command, ...args] = process.argv;
if (!command) {
  console.error("Usage: node scripts/run-with-env.mjs <command> [...args]");
  process.exit(1);
}

loadEnvFileIfExists(path.resolve(process.cwd(), ".env"));
loadEnvFileIfExists(path.resolve(process.cwd(), "../../.env"));

const result = spawnSync(command, args, {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
