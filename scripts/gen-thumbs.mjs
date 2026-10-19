// 给库里已有的照片批量补生成 480px WebP 缩略图（照片墙上用，流量降到 ~1/10）：
//   node scripts/gen-thumbs.mjs
// 覆盖 local / oss 两种模式；幂等：已有缩略图的自动跳过。
import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

// --- 手写解析 .env.local（避免引入 dotenv）---
const env = {};
try {
  const raw = await readFile(path.join(process.cwd(), ".env.local"), "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = env[m[2]]?.trim?.() ?? m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* 没有 .env.local */
}

const OSS_MODE = Boolean(env.OSS_BUCKET && env.OSS_ACCESS_KEY_ID && env.OSS_ACCESS_KEY_SECRET && env.OSS_ENDPOINT);
const BUCKET = env.OSS_BUCKET;
const AK = env.OSS_ACCESS_KEY_ID;
const SK = env.OSS_ACCESS_KEY_SECRET;
const ENDPOINT = (env.OSS_ENDPOINT ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");

function signedUrl(verb, key, mime, expiresSec) {
  const expires = Math.floor(Date.now() / 1000) + expiresSec;
  const sig = createHmac("sha1", SK).update(`${verb}\n\n${mime}\n${expires}\n/${BUCKET}/${key}`).digest("base64");
  const q = new URLSearchParams({ OSSAccessKeyId: AK, Expires: String(expires), Signature: sig });
  return `https://${BUCKET}.${ENDPOINT}/${key}?${q}`;
}

const sharp = (await import("sharp")).default;
const MEDIA_DIR = path.join(process.cwd(), "data", "media");

const db = new Database(path.join(process.cwd(), "data", "journal.db"));
const rows = db.prepare("SELECT id, filename FROM media WHERE kind = 'photo'").all();

if (rows.length === 0) {
  console.log("库里没有照片，不用生成。");
  process.exit(0);
}

const thumbOf = (id) => `media/${id}_thumb.webp`;
const localThumb = (id) => path.join(MEDIA_DIR, `${id}_thumb.webp`);

async function thumbExists(id) {
  if (OSS_MODE) {
    const res = await fetch(signedUrl("HEAD", thumbOf(id), "", 60), { method: "HEAD" }).catch(() => null);
    return Boolean(res && res.ok);
  }
  return stat(localThumb(id)).then(
    () => true,
    () => false
  );
}

let done = 0;
let skipped = 0;
let failed = 0;
for (const row of rows) {
  const id = row.id;
  try {
    if (await thumbExists(id)) {
      skipped++;
      continue;
    }
    // 拿原图字节
    let input;
    if (row.filename.startsWith("media/")) {
      if (!OSS_MODE) throw new Error("filename 是 OSS key 但没配 OSS 环境变量");
      const res = await fetch(signedUrl("GET", row.filename, "", 300));
      if (!res.ok) throw new Error(`OSS 拉取失败 (${res.status})`);
      input = Buffer.from(await res.arrayBuffer());
    } else {
      input = await readFile(path.join(MEDIA_DIR, row.filename));
    }

    const buf = await sharp(input).rotate().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();

    if (OSS_MODE) {
      const put = signedUrl("PUT", thumbOf(id), "image/webp", 300);
      const res = await fetch(put, { method: "PUT", headers: { "Content-Type": "image/webp" }, body: new Uint8Array(buf) });
      if (!res.ok) throw new Error(`缩略图传 OSS 失败 (${res.status})`);
    } else {
      await writeFile(localThumb(id), buf);
    }
    done++;
    if (done % 20 === 0) console.log(`已生成 ${done}…`);
  } catch (e) {
    failed++;
    console.error(`✗ ${id}: ${e.message}`);
  }
}

console.log(`完成：生成 ${done} 张，跳过（已有）${skipped} 张，失败 ${failed} 张。`);
