// 给库里已有的视频补封面（ffmpeg 抽第一帧 480px JPG）：npm run gen-posters
// 覆盖 local / oss；幂等：已有封面的自动跳过。HEVC 视频在电脑浏览器上解不出首帧，封面是唯一可靠的预览。
import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const env = {};
try {
  const raw = await import("node:fs").then((fs) => fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8"));
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* 没有 .env.local */
}

const OSS_MODE = Boolean(env.OSS_BUCKET && env.OSS_ACCESS_KEY_ID && env.OSS_ACCESS_KEY_SECRET && env.OSS_ENDPOINT);
// ffmpeg 位置：FFMPEG_PATH（服务器 ~/apps/ffmpeg）→ 系统 PATH 里的 ffmpeg
const ffmpeg = env.FFMPEG_PATH || (existsSync(path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg")) ? path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg") : "ffmpeg");

function signedUrl(verb, key, mime, expiresSec) {
  const expires = Math.floor(Date.now() / 1000) + expiresSec;
  const sig = createHmac("sha1", env.OSS_ACCESS_KEY_SECRET).update(`${verb}\n\n${mime}\n${expires}\n/${env.OSS_BUCKET}/${key}`).digest("base64");
  const q = new URLSearchParams({ OSSAccessKeyId: env.OSS_ACCESS_KEY_ID, Expires: String(expires), Signature: sig });
  return `https://${env.OSS_BUCKET}.${env.OSS_ENDPOINT}/${key}?${q}`;
}

function internalUrl(url) {
  const ep = env.OSS_ENDPOINT ?? "";
  if (!ep || ep.includes("-internal")) return url;
  return url.replace(ep, ep.replace(".aliyuncs.com", "-internal.aliyuncs.com"));
}

async function posterExists(id) {
  if (OSS_MODE) {
    const res = await fetch(signedUrl("HEAD", `media/${id}_poster.jpg`, "", 60), { method: "HEAD" }).catch(() => null);
    return Boolean(res && res.ok);
  }
  return existsSync(path.join(process.cwd(), "data", "media", `${id}_poster.jpg`));
}

const db = new Database(path.join(process.cwd(), "data", "journal.db"));
const rows = db.prepare("SELECT id, filename, bytes FROM media WHERE kind = 'video' ORDER BY created_at").all();
console.log(`视频共 ${rows.length} 个（${OSS_MODE ? "oss" : "local"} 模式），开始补封面…`);

let done = 0;
let skip = 0;
let failed = 0;
for (const row of rows) {
  try {
    if (await posterExists(row.id)) {
      skip += 1;
      continue;
    }
    const dir = await mkdtemp(path.join(os.tmpdir(), "poster-"));
    const out = path.join(dir, `${row.id}.jpg`);
    try {
      let input;
      if (OSS_MODE) {
        // ffmpeg 直读 OSS https 在部分服务器上会崩：先拉到本地（优先内网地址）再抽帧
        const url = signedUrl("GET", row.filename, "", 600);
        let res = await fetch(internalUrl(url)).catch(() => null);
        if (!res?.ok) res = await fetch(url).catch(() => null);
        if (!res?.ok) throw new Error(`拉视频失败 (${res?.status ?? "网络"})`);
        const tmp = path.join(dir, "in.bin");
        const { writeFile: wf } = await import("node:fs/promises");
        await wf(tmp, Buffer.from(await res.arrayBuffer()));
        input = tmp;
      } else {
        input = path.join(process.cwd(), "data", "media", row.filename);
      }
      await new Promise((resolve, reject) => {
        execFile(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", input, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", out], { timeout: 120000 }, (err) => (err ? reject(err) : resolve()));
      });
      const { readFile } = await import("node:fs/promises");
      const buf = await readFile(out);
      if (buf.byteLength === 0) throw new Error("空封面");
      if (OSS_MODE) {
        const res = await fetch(signedUrl("PUT", `media/${row.id}_poster.jpg`, "image/jpeg", 300), {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: new Uint8Array(buf),
        });
        if (!res.ok) throw new Error(`OSS PUT ${res.status}`);
      } else {
        await writeFile(path.join(process.cwd(), "data", "media", `${row.id}_poster.jpg`), buf);
      }
      done += 1;
    } finally {
      void rm(dir, { recursive: true, force: true });
    }
  } catch (e) {
    failed += 1;
    console.error(`✗ ${row.id}: ${e.message?.slice(0, 120)}`);
  }
  if ((done + skip) % 25 === 0) console.log(`  进度 ${done + skip}/${rows.length}`);
}
console.log(`完成：新补 ${done}，已有 ${skip}，失败 ${failed}`);
