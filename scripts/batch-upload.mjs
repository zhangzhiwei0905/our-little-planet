// 批量把一个文件夹的照片/视频/Live 图（livp）传进线上相册：
//   node scripts/batch-upload.mjs /path/to/文件夹
// 走和网页一样的三步上传 + 按拍摄日期（文件名）分页建「存照片」条目；livp 自动拆成 照片+Live 视频。
// 幂等：处理过的文件记在 .batch-upload-manifest.json，中断后重跑会跳过。
// 连接：BASE 指向站点（默认 http://localhost:3000；线上可用 SSH 隧道转发到本机端口），配了 OSS 时大文件直传签名地址。
// 用法：AUTHOR_PASSWORD=作者口令 BASE=https://example.com node scripts/batch-upload.mjs <文件夹>
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

const BASE = process.env.BASE ?? "http://localhost:3000";
const AUTHOR_PASSWORD = process.env.AUTHOR_PASSWORD;
if (!AUTHOR_PASSWORD) {
  console.error("缺 AUTHOR_PASSWORD 环境变量（线上作者口令）");
  process.exit(1);
}
const ROOT = process.argv[2];
if (!ROOT || !existsSync(ROOT)) {
  console.error("用法：node scripts/batch-upload.mjs <文件夹>");
  process.exit(1);
}

// ---------- 登录拿 cookie ----------
const loginRes = await fetch(`${BASE}/api/pen`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: AUTHOR_PASSWORD }),
});
if (!loginRes.ok) throw new Error(`作者口令不对 (${loginRes.status})`);
const penCookie = (loginRes.headers.get("set-cookie") ?? "").split(";")[0];

// ---------- 工具 ----------
function filenameDate(name) {
  const m = name.match(/(?:^|[^\d])(\d{4})[-_. ](\d{1,2})[-_. ](\d{1,2})(?!\d)/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function filenameTime(name) {
  const m = name.match(/(\d{2})(\d{2})(\d{2})/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
/** 和前端一致：扫头尾字节判断 HEVC / H.264 */
function sniffHevc(buf) {
  const scan = (b) => {
    let hevc = false, avc = false;
    for (let i = 0; i + 4 <= b.length; i++) {
      const c = b[i];
      if (c !== 0x68 && c !== 0x64 && c !== 0x61) continue;
      const tag = String.fromCharCode(c, b[i + 1], b[i + 2], b[i + 3]);
      if (tag === "hvc1" || tag === "hev1" || tag === "dvh1" || tag === "dvhe") hevc = true;
      else if (tag === "avc1") avc = true;
    }
    if (hevc && !avc) return true;
    if (avc && !hevc) return false;
    return null;
  };
  const head = buf.subarray(0, Math.min(1_000_000, buf.length));
  let r = scan(head);
  if (r !== null) return r;
  if (buf.length > 1_500_000) r = scan(buf.subarray(Math.max(1_000_000, buf.length - 12_000_000)));
  return r;
}
async function sharpDims(buf) {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    return { width: meta.width ?? 0, height: meta.height ?? 0 };
  } catch {
    return { width: 0, height: 0 };
  }
}

const MIME = { ".heic": "image/heic", ".heif": "image/heif", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".mov": "video/quicktime", ".mp4": "video/mp4", ".m4v": "video/mp4" };

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { ...(opts.headers ?? {}), Cookie: penCookie } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${body.error ?? ""}`);
  return body;
}

/** 三步上传一段媒体；HEIC 走服务端中转（顺带回填真实宽高），其它直传 OSS */
async function uploadOne(name, mime, buf) {
  const prep = await api("/api/upload/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mime, size: buf.length }),
  });
  // local 模式的中转地址是相对路径（/api/upload/...），要拼上 BASE 并带上登录态；OSS 是完整地址、直传
  const isRelay = prep.uploadUrl.startsWith("/");
  const putUrl = isRelay ? `${BASE}${prep.uploadUrl}` : prep.uploadUrl;
  const putHeaders = isRelay ? { "Content-Type": "application/octet-stream", Cookie: penCookie } : { "Content-Type": mime };
  const putRes = await fetch(putUrl, { method: "PUT", headers: putHeaders, body: buf });
  if (!putRes.ok) throw new Error(`PUT ${name} -> ${putRes.status} ${(await putRes.text()).slice(0, 120)}`);
  const put = (await putRes.json().catch(() => ({}))) ?? {};
  const dims = put.width ? { width: put.width, height: put.height } : mime.startsWith("image/") ? await sharpDims(buf) : { width: 0, height: 0 };
  const done = await api("/api/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mediaId: prep.mediaId,
      key: put.key ?? prep.key,
      mime: put.mime ?? prep.mime,
      bytes: put.bytes ?? buf.length,
      width: dims.width,
      height: dims.height,
      hevc: mime.startsWith("video/") ? (sniffHevc(buf) ?? undefined) : undefined,
    }),
  });
  return done.media;
}

/** 把一个文件（livp / heic / jpg / png）变成待挂载的媒体卡 */
async function buildCards(file) {
  const full = path.join(ROOT, file);
  const base = file.replace(/\.\w+$/, "");
  const lower = file.toLowerCase();
  if (lower.endsWith(".livp")) {
    const entries = unzipSync(new Uint8Array(readFileSync(full)));
    let photo = null, video = null;
    for (const [name, data] of Object.entries(entries)) {
      if (name.startsWith("__MACOSX") || name.startsWith(".")) continue;
      if (/\.(mov|mp4|m4v)$/i.test(name) && !video) video = { data, ext: name.match(/\.\w+$/)[0].toLowerCase() };
      else if (/\.(heic|heif|jpe?g|png|webp)$/i.test(name) && !photo) photo = { data, ext: name.match(/\.\w+$/)[0].toLowerCase() };
    }
    if (!photo && !video) throw new Error("livp 里没找到照片/视频");
    const cards = [];
    if (photo) {
      const mime = MIME[photo.ext] ?? "application/octet-stream";
      const m = await uploadOne(`${base}${photo.ext}`, mime, photo.data);
      cards.push({ media: m, kind: "photo" });
    }
    if (video) {
      const mime = MIME[video.ext] ?? "video/quicktime";
      const m = await uploadOne(`${base}${video.ext}`, mime, video.data);
      cards.push({ media: m, kind: "video" });
    }
    // 同一个 livp 出来的照片+视频配成 Live
    const p = cards.find((c) => c.kind === "photo");
    const v = cards.find((c) => c.kind === "video");
    if (p && v) p.liveVideoId = v.media.id;
    return { date: filenameDate(file), time: filenameTime(file), cards };
  }
  if (/\.(heic|heif|jpe?g|png|webp)$/i.test(lower)) {
    const buf = readFileSync(full);
    const m = await uploadOne(file, MIME[path.extname(lower)] ?? "application/octet-stream", buf);
    return { date: filenameDate(file), time: filenameTime(file), cards: [{ media: m, kind: "photo" }] };
  }
  if (/\.(mov|mp4|m4v)$/i.test(lower)) {
    const buf = readFileSync(full);
    const m = await uploadOne(file, MIME[path.extname(lower)] ?? "video/quicktime", buf);
    return { date: filenameDate(file), time: filenameTime(file), cards: [{ media: m, kind: "video" }] };
  }
  return null;
}

// ---------- 主流程 ----------
const manifestPath = path.join(ROOT, ".batch-upload-manifest.json");
const done = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
const files = readdirSync(ROOT)
  .filter((f) => statSync(path.join(ROOT, f)).isFile() && !f.startsWith(".") && /\.(livp|heic|heif|jpe?g|png|webp|mov|mp4|m4v)$/i.test(f))
  .sort();
const todo = files.filter((f) => !done[f]);
console.log(`共 ${files.length} 个文件，已处理 ${files.length - todo.length}，待处理 ${todo.length}`);

const byDate = new Map(); // date -> [{id, caption, sort, liveVideoId}]
let sortSeq = 0;
let failed = [];

for (const f of todo) {
  const t0 = Date.now();
  try {
    const built = await buildCards(f);
    if (!built) { done[f] = "skipped"; continue; }
    const date = built.date ?? new Date().toLocaleDateString("en-CA");
    if (!byDate.has(date)) byDate.set(date, []);
    for (const c of built.cards) {
      if (c.kind === "photo") {
        byDate.get(date).push({ id: c.media.id, caption: "", sort: sortSeq++, liveVideoId: c.liveVideoId ?? null });
      } else if (!c.liveVideoId) {
        // 没被配对的视频也进相册；被配对的视频挂到同一天里（排序靠后，不单独展示）
        byDate.get(date).push({ id: c.media.id, caption: "", sort: 90000 + sortSeq, liveVideoId: null });
      }
    }
    done[f] = "ok";
    writeFileSync(manifestPath, JSON.stringify(done));
    console.log(`✓ ${f}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  } catch (e) {
    failed.push(f);
    console.error(`✗ ${f}: ${e.message}`);
  }
}

// 按天建「存照片」条目
let created = 0;
for (const [date, media] of [...byDate.entries()].sort()) {
  media.sort((a, b) => a.sort - b.sort);
  await api("/api/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "photo", body: "", entryDate: date, media }),
  });
  created += 1;
  console.log(`📖 ${date}：贴了 ${media.filter((m) => m.liveVideoId || m.sort < 90000).length} 张（含 Live 配对）`);
}

console.log(`\n完成：${todo.length - failed.length}/${todo.length} 个文件，建了 ${created} 页；失败 ${failed.length} 个${failed.length ? "：" + failed.join(", ") : ""}`);
