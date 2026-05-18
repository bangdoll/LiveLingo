import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const appRoot = normalize(join(__dirname, ".."));

const envPaths = [
  join(appRoot, ".env.local"),
  join(appRoot, ".env"),
  "/Users/aios/Projects/00.AI-Notes_Local/.env"
].filter((path) => existsSync(path));

loadEnv({ path: envPaths });

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const checks = [
  ["OPENAI_API_KEY", Boolean(process.env.OPENAI_API_KEY)],
  ["server.mjs", await exists(join(appRoot, "server.mjs"))],
  ["public/index.html", await exists(join(appRoot, "public/index.html"))],
  ["public/app.js", await exists(join(appRoot, "public/app.js"))],
  ["public/styles.css", await exists(join(appRoot, "public/styles.css"))]
];

const packageJson = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));

console.log("LiveLingo 即時雙語語音助理檢查");
console.log(`- 專案：${packageJson.name}`);
console.log(`- 模型：${process.env.ADA_REALTIME_MODEL || "gpt-realtime-2"}`);
console.log(`- 語音：${process.env.ADA_REALTIME_VOICE || "marin"}`);

let ok = true;
for (const [name, passed] of checks) {
  console.log(`- ${name}: ${passed ? "yes" : "no"}`);
  if (!passed) ok = false;
}

if (!ok) {
  process.exitCode = 1;
}
