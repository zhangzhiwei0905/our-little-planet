// 给库里已有的照片/视频补内容指纹（大小-头尾sha256）：npm run backfill-fingerprints
// 补完后，网页端选文件时才能识别「这些已经传过了」。幂等：已有指纹的自动跳过。
import Database from "better-sqlite3";
import { createHash, createHmac } from "node:crypto";
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

const OSS_MODE = Boolean(env.OSS_BUCKET && env.OSS_ACCESS_KEY_ID && env.OSS_ACCESS_KEY_SECRET && env.OSS_ENDPOINT);

function signedGetUrl(key, expiresSec = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresSec;
  const sig = createHmac("sha1", env.OSS_ACCESS_KEY_SECRET)
    .update(`GET\n\n\n${expires}\n/${env.OSS_BUCKET}/${key}`)
    .digest("base64");
  return `https://${env.OSS_BUCKET}.${env.OSS_ENDPOINT}/${key}?OSSAccessKeyId=${env.OSS_ACCESS_KEY_ID}&Expires=${expires}&Signature=${encodeURIComponent(sig)}`;
}

const HASH_SPAN = 524_288; // 512KB，与 src/lib/client-upload.ts 的 fileFingerprint 保持一致

function fpOf(size, head, tail) {
  let bytes;
  if (size <= 1_048_576) {
    bytes = head; // 小文件整段就是头
  } else {
    bytes = Buffer.concat([head.subarray(0, HASH_SPAN), tail.subarray(Math.max(0, tail.length - HASH_SPAN))]);
  }
  return `${size}-${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readRange(row, start, end) {
  if (OSS_MODE) {
    if (!row.filename.startsWith("media/")) return null;
    const res = await fetch(signedGetUrl(row.filename), { headers: { Range: `bytes=${start}-${end}` } }).catch(() => null);
    if (!res || !(res.ok || res.status === 206)) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(path.join(process.cwd(), "data", "media", row.filename)).then((b) => b.subarray(start, end + 1)).catch(() => null);
}

const db = new Database(path.join(process.cwd(), "data", "journal.db"));
const rows = db
  .prepare("SELECT id, filename, bytes, kind FROM media WHERE fingerprint IS NULL AND kind IN ('photo', 'video')")
  .all();
console.log(`待补指纹：${rows.length} 个（${OSS_MODE ? "oss" : "local"} 模式）`);

let done = 0;
let failed = 0;
const stmt = db.prepare("UPDATE media SET fingerprint = ? WHERE id = ?");
for (const row of rows) {
  try {
    let fp;
    if (row.bytes <= 1_048_576) {
      const whole = await readRange(row, 0, row.bytes - 1);
      if (!whole) throw new Error("读不到");
      fp = fpOf(row.bytes, whole.subarray(0, row.bytes), whole.subarray(0, row.bytes));
    } else {
      const head = await readRange(row, 0, HASH_SPAN - 1);
      const tail = await readRange(row, row.bytes - HASH_SPAN, row.bytes - 1);
      if (!head || !tail) throw new Error("读不到");
      fp = fpOf(row.bytes, head, tail);
    }
    if (!/^\d{1,13}-[a-f0-9]{64}$/.test(fp)) throw new Error("指纹不对");
    stmt.run(fp, row.id);
    done += 1;
  } catch {
    failed += 1;
  }
  if (done % 50 === 0 && done > 0) console.log(`  已补 ${done}`);
}
console.log(`完成：${done} 个补上，${failed} 个失败`);
