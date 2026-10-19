// 把库里已存的 HEIC/HEIF 照片批量转成 JPEG（修复桌面浏览器显示不了的问题）：
//   npm run convert-heic
// 覆盖 local / oss 两种模式：local 直接换本地文件，oss 重新上传新对象并删旧对象。
// 幂等：非 HEIC 的行自动跳过。
import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
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

const { default: heicConvert } = await import("heic-convert");
const sharp = (await import("sharp")).default;

const db = new Database(path.join(process.cwd(), "data", "journal.db"));
const rows = db.prepare("SELECT id, filename, mime FROM media WHERE mime IN ('image/heic', 'image/heif')").all();

if (rows.length === 0) {
  console.log("库里没有 HEIC 照片，不用转。");
  process.exit(0);
}

let done = 0;
let failed = 0;
for (const row of rows) {
  try {
    let input;
    if (row.filename.startsWith("media/")) {
      if (!OSS_MODE) throw new Error("filename 是 OSS key 但没配 OSS 环境变量");
      const res = await fetch(signedUrl("GET", row.filename, "", 300));
      if (!res.ok) throw new Error(`OSS 拉取失败 (${res.status})`);
      input = Buffer.from(await res.arrayBuffer());
    } else {
      input = await readFile(path.join(process.cwd(), "data", "media", row.filename));
    }

    const decoded = await heicConvert({ buffer: input, format: "JPEG", quality: 0.92 });
    const out = await sharp(decoded)
      .rotate()
      .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });

    const newFilename = `${row.id}.jpg`;
    if (OSS_MODE) {
      const key = `media/${newFilename}`;
      const put = await fetch(signedUrl("PUT", key, "image/jpeg", 300), {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: out.data,
      });
      if (!put.ok) throw new Error(`OSS 上传失败 (${put.status})`);
      if (row.filename.startsWith("media/")) {
        await fetch(signedUrl("DELETE", row.filename, "", 60), { method: "DELETE" }).catch(() => undefined);
      }
      db.prepare("UPDATE media SET filename = ?, mime = 'image/jpeg', bytes = ?, width = ?, height = ? WHERE id = ?").run(
        key,
        out.data.length,
        out.info.width,
        out.info.height,
        row.id
      );
    } else {
      await writeFile(path.join(process.cwd(), "data", "media", newFilename), out.data);
      await unlink(path.join(process.cwd(), "data", "media", row.filename)).catch(() => undefined);
      db.prepare("UPDATE media SET filename = ?, mime = 'image/jpeg', bytes = ?, width = ?, height = ? WHERE id = ?").run(
        newFilename,
        out.data.length,
        out.info.width,
        out.info.height,
        row.id
      );
    }
    done++;
    console.log(`✓ ${row.filename} → ${newFilename} (${out.info.width}x${out.info.height}, ${(out.data.length / 1024) | 0}KB)`);
  } catch (e) {
    failed++;
    console.error(`✗ ${row.filename}：${e instanceof Error ? e.message : e}`);
  }
}

console.log(`\n完成：${done} 转好，${failed} 失败。`);
