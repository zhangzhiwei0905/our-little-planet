// 把本地 data/media 的内容迁移到阿里云 OSS（配好 .env.local 的 OSS_* 后运行一次）：
//   node scripts/migrate-to-oss.mjs
// 幂等：已迁移（filename 以 media/ 开头）的行自动跳过。本地文件保留作备份。
import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

// --- 手写解析 .env.local（避免引入 dotenv）---
const env = {};
try {
  const raw = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* 没有 .env.local */
}

const BUCKET = env.OSS_BUCKET;
const AK = env.OSS_ACCESS_KEY_ID;
const SK = env.OSS_ACCESS_KEY_SECRET;
const ENDPOINT = (env.OSS_ENDPOINT ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
if (!BUCKET || !AK || !SK || !ENDPOINT) {
  console.error("请先在 .env.local 配置 OSS_BUCKET / OSS_ENDPOINT / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET");
  process.exit(1);
}

function putUrl(key, mime) {
  const expires = Math.floor(Date.now() / 1000) + 300;
  const sig = createHmac("sha1", SK).update(`PUT\n\n${mime}\n${expires}\n/${BUCKET}/${key}`).digest("base64");
  const q = new URLSearchParams({ OSSAccessKeyId: AK, Expires: String(expires), Signature: sig });
  return `https://${BUCKET}.${ENDPOINT}/${key}?${q}`;
}

const db = new Database(path.join(process.cwd(), "data", "journal.db"));
const rows = db.prepare("SELECT id, filename, mime, bytes FROM media").all();

let migrated = 0;
let skipped = 0;
let failed = 0;
for (const row of rows) {
  if (row.filename.startsWith("media/")) {
    skipped++;
    continue;
  }
  const file = path.join(process.cwd(), "data", "media", row.filename);
  const buf = await readFile(file).catch(() => null);
  if (!buf) {
    console.error(`✗ 本地文件不存在：${row.filename}（跳过）`);
    failed++;
    continue;
  }
  const key = `media/${row.filename}`;
  const res = await fetch(putUrl(key, row.mime), {
    method: "PUT",
    headers: { "Content-Type": row.mime },
    body: buf,
  }).catch(() => null);
  if (!res || !res.ok) {
    console.error(`✗ 上传失败：${row.filename} ${res ? res.status : "网络错误"}`);
    failed++;
    continue;
  }
  db.prepare("UPDATE media SET filename = ? WHERE id = ?").run(key, row.id);
  migrated++;
  console.log(`✓ ${row.filename} → oss://${BUCKET}/${key}`);
}

console.log(`\n完成：迁移 ${migrated}，跳过（已迁移）${skipped}，失败 ${failed}`);
if (failed === 0) console.log("本地文件保留在 data/media/，确认网站正常后可自行归档。");
db.close();
