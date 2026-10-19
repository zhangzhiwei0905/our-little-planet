import path from "node:path";
import { db, MEDIA_DIR, type MediaRow } from "./db";
export type { MediaRow } from "./db";
import { demoSampleBytes, demoSampleFor, IS_DEMO } from "./demo";
import { newId, nowISO } from "./ids";
import {
  deleteStoredObject,
  localDirectUrl,
  objectKeyFor,
  ossGetUrl,
  ossPutUrl,
  storageMode,
} from "./storage";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
};

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

/** 单文件上传上限：手机 4K 视频随便就超 300MB，放到 2GB（OSS 单次 PUT 上限 5GB，够用） */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** 照片墙上用的缩略图宽度（WebP，约 20-60KB 一张，流量是原图的 ~1/10） */
export const THUMB_WIDTH = 480;

export function thumbName(mediaId: string): string {
  return `${mediaId}_thumb.webp`;
}

export function thumbKey(mediaId: string): string {
  return objectKeyFor(mediaId, "_thumb.webp");
}

/** 视频封面：ffmpeg 抽第一帧（480px JPG）。
 *  HEVC 视频在桌面 Chrome 上解不出首帧，墙上的视频卡统一用服务端抽好的封面图，
 *  既能显示又省流量（不用拉视频元信息） */
export function posterName(mediaId: string): string {
  return `${mediaId}_poster.jpg`;
}

export function posterKey(mediaId: string): string {
  return objectKeyFor(mediaId, "_poster.jpg");
}

/** ffmpeg 位置：FFMPEG_PATH 指定（服务器放在 ~/apps/ffmpeg）→ 本地 node_modules 里装过 ffmpeg-static 就用 → 系统 PATH 里的 ffmpeg */
export async function resolveFfmpegPath(): Promise<string | null> {
  let bundled: string | null = null;
  try {
    bundled = ((await import("ffmpeg-static")).default as string | null) ?? null;
  } catch {
    /* 没装 ffmpeg-static（生产环境不装，靠 FFMPEG_PATH） */
  }
  const { existsSync } = await import("node:fs");
  const candidates = [process.env.FFMPEG_PATH, bundled, path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"), "ffmpeg"].filter(
    (p): p is string => Boolean(p)
  );
  return candidates.find((p) => p === "ffmpeg" || existsSync(p)) ?? null;
}

/** ffmpeg 读媒体元信息（best-effort）：HEVC 标记、时长、尺寸。视频和录音都走这里。
 *  传路径（零拷贝，优先）或 Buffer（写临时文件再探）；
 *  没有 ffmpeg 或解析失败都返回空对象 */
export async function probeMediaMeta(
  input: string | Buffer
): Promise<{ hevc?: boolean; duration?: number; width?: number; height?: number }> {
  const { execFile } = await import("node:child_process");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const pathMod = await import("node:path");
  const ffmpegPath = await resolveFfmpegPath();
  if (!ffmpegPath) return {};
  let inputArg = input as string;
  let dir: string | null = null;
  try {
    if (Buffer.isBuffer(input)) {
      dir = await mkdtemp(pathMod.join(os.tmpdir(), "probe-"));
      inputArg = pathMod.join(dir, "in.bin");
      await writeFile(inputArg, input);
    }
    // 不给输出文件，ffmpeg 必然报错退出，但 stderr 里已经打印了元信息
    const stderr = await new Promise<string>((resolve) => {
      execFile(ffmpegPath, ["-hide_banner", "-i", inputArg], { timeout: 20_000 }, (err, _stdout, errText) =>
        resolve(errText ?? (err ? String(err) : ""))
      );
    });
    const out: { hevc?: boolean; duration?: number; width?: number; height?: number } = {};
    if (/Video:\s*hevc/i.test(stderr)) out.hevc = true;
    const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (dur) out.duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
    const dim = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
    if (dim) {
      out.width = Number(dim[1]);
      out.height = Number(dim[2]);
    }
    return out;
  } catch {
    return {};
  } finally {
    if (dir) void rm(dir, { recursive: true, force: true });
  }
}

/** 补齐媒体行里缺的元信息（时长/尺寸/HEVC）：快捷指令直传的视频登记时拿不到这些
 *  （ffmpeg 要读文件），封面任务本来就会把文件弄到本地，顺带探一把写回数据库 */
async function enrichMediaMeta(row: MediaRow, input: string | Buffer): Promise<void> {
  const meta = await probeMediaMeta(input);
  const duration = row.duration ?? (meta.duration && meta.duration > 0 ? Math.round(meta.duration * 10) / 10 : null);
  const width = row.width ?? meta.width ?? null;
  const height = row.height ?? meta.height ?? null;
  const hevc = row.hevc ?? (meta.hevc === true ? 1 : null);
  if (duration === row.duration && width === row.width && height === row.height && hevc === row.hevc) return;
  db.prepare("UPDATE media SET duration = ?, width = ?, height = ?, hevc = ? WHERE id = ?").run(
    duration,
    width,
    height,
    hevc,
    row.id
  );
}

export async function makePoster(mediaId: string, input: string | Buffer): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const pathMod = await import("node:path");
  const ffmpegPath = await resolveFfmpegPath();
  if (!ffmpegPath) throw new Error("ffmpeg 不可用");
  const dir = await mkdtemp(pathMod.join(os.tmpdir(), "poster-"));
  try {
    let inputArg = input as string;
    if (Buffer.isBuffer(input)) {
      inputArg = pathMod.join(dir, "in.bin");
      await writeFile(inputArg, input);
    }
    const out = pathMod.join(dir, `${mediaId}.jpg`);
    await new Promise<void>((resolve, reject) => {
      execFile(
        ffmpegPath,
        ["-hide_banner", "-loglevel", "error", "-i", inputArg, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", out],
        { timeout: 30000 },
        (err) => (err ? reject(new Error(`ffmpeg 抽帧失败: ${err.message}`)) : resolve())
      );
    });
    const buf = await readFile(out);
    if (buf.byteLength === 0) throw new Error("封面是空的");
    if (storageMode() === "oss") {
      const putUrl = ossPutUrl(posterKey(mediaId), "image/jpeg");
      const res = await fetch(putUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(buf) });
      if (!res.ok) throw new Error(`封面上传 OSS 失败 (${res.status})`);
      return;
    }
    await (await import("node:fs/promises")).writeFile(path.join(MEDIA_DIR, posterName(mediaId)), buf);
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

/** 生成缩略图：local 写盘 data/media/<id>_thumb.webp，oss 传对象 media/<id>_thumb.webp */
export async function makeThumb(mediaId: string, input: Buffer): Promise<void> {
  const sharp = (await import("sharp")).default;
  const buf = await sharp(input)
    .rotate()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
  if (storageMode() === "oss") {
    const putUrl = ossPutUrl(thumbKey(mediaId), "image/webp");
    const res = await fetch(putUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/webp" },
      body: new Uint8Array(buf),
    });
    if (!res.ok) throw new Error(`缩略图传 OSS 失败 (${res.status})`);
    return;
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(MEDIA_DIR, thumbName(mediaId)), buf);
}

/** 同 region 的 ECS 走 OSS 内网地址拉文件（免流量费、更快）；签名对 host 不敏感，换域名照样有效 */
function internalOssUrl(url: string): string {
  const ep = process.env.OSS_ENDPOINT ?? "";
  if (!ep || ep.includes("-internal")) return url;
  return url.replace(ep, ep.replace(".aliyuncs.com", "-internal.aliyuncs.com"));
}

/** 上传完成后异步补缩略图/视频封面：失败不打断上传（墙上暂时回落原样，后台补上自然切换） */
async function thumbAfterUpload(row: MediaRow): Promise<void> {
  if (IS_DEMO) return; // 演示站的媒体都指向现成样例文件，缩略图走原图回落、封面走视频首帧，不用再生成
  try {
    if (row.kind === "video") {
      if (storageMode() === "oss") {
        // ffmpeg 直读 OSS 的 https 地址在这个服务器的静态构建上会崩（TLS 问题），
        // 先拉到临时文件再抽帧；优先走内网地址
        const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
        const os = await import("node:os");
        const pathMod = await import("node:path");
        const dir = await mkdtemp(pathMod.join(os.tmpdir(), "poster-"));
        try {
          const url = ossGetUrl(row.filename, 600);
          let res = await fetch(internalOssUrl(url)).catch(() => null);
          if (!res?.ok) res = await fetch(url).catch(() => null);
          if (!res?.ok) throw new Error(`拉视频失败 (${res?.status ?? "网络"})`);
          const tmp = pathMod.join(dir, "in.bin");
          const buf = Buffer.from(await res.arrayBuffer());
          await writeFile(tmp, buf);
          await enrichMediaMeta(row, tmp).catch(() => undefined);
          await makePoster(row.id, tmp);
        } finally {
          void rm(dir, { recursive: true, force: true });
        }
        return;
      }
      await enrichMediaMeta(row, mediaPath(row)).catch(() => undefined);
      await makePoster(row.id, mediaPath(row));
      return;
    }
    if (row.kind === "audio") {
      // 快捷指令直传的录音登记时没有时长；录音都小，拉回来补上就好
      if (row.duration != null) return;
      if (storageMode() === "oss") {
        let res = await fetch(internalOssUrl(ossGetUrl(row.filename))).catch(() => null);
        if (!res?.ok) res = await fetch(ossGetUrl(row.filename)).catch(() => null);
        if (res?.ok) await enrichMediaMeta(row, Buffer.from(await res.arrayBuffer())).catch(() => undefined);
        return;
      }
      await enrichMediaMeta(row, mediaPath(row)).catch(() => undefined);
      return;
    }
    if (row.kind === "photo") {
      let input: Buffer | null = null;
      if (storageMode() === "oss") {
        let res = await fetch(internalOssUrl(ossGetUrl(row.filename))).catch(() => null);
        if (!res?.ok) res = await fetch(ossGetUrl(row.filename)).catch(() => null);
        if (res?.ok) input = Buffer.from(await res.arrayBuffer());
      } else {
        const { readFile } = await import("node:fs/promises");
        input = await readFile(mediaPath(row)).catch(() => null);
      }
      if (input) await makeThumb(row.id, input);
    }
  } catch (e) {
    // 补图失败不阻塞上传，但留个日志好排查（ffmpeg 缺失 / 解不开之类）
    console.error(`[media] 补缩略图/封面失败 ${row.id} (${row.kind}):`, e instanceof Error ? e.message : e);
  }
}

export function extFor(mime: string, name: string): string {
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const ext = name.slice(dot).toLowerCase();
    if (MIME_BY_EXT[ext]) return ext;
  }
  return ".bin";
}

export function normalizeMime(mime: string, name: string): string {
  if (EXT_BY_MIME[mime]) return mime;
  const dot = name.lastIndexOf(".");
  if (dot > 0) return MIME_BY_EXT[name.slice(dot).toLowerCase()] ?? mime;
  return mime;
}

export function isAcceptedFile(mime: string, name: string): boolean {
  if (EXT_BY_MIME[mime]) return true;
  const dot = name.lastIndexOf(".");
  return dot > 0 && Boolean(MIME_BY_EXT[name.slice(dot).toLowerCase()]);
}

export type PrepareResult = {
  mediaId: string;
  key: string; // OSS 对象 key（local 模式也统一用这个形态校验）
  uploadUrl: string; // 浏览器 PUT 目标：OSS 签名直传 / 本地中转端点
  mime: string;
};

/** 第一步：登记一个待上传对象，返回直传地址。不落库，complete 时才入库 */
export function prepareMediaUpload(name: string, rawMime: string): PrepareResult {
  const mime = normalizeMime(rawMime, name);
  const mediaId = newId();
  const ext = extFor(mime, name);
  const key = objectKeyFor(mediaId, ext);
  if (mime === "image/heic" || mime === "image/heif") {
    // HEIC 不直传：桌面浏览器普遍解码不了，改走服务端中转转成 JPEG，
    // 真正的 key/mime 由中转接口的响应给出（客户端 complete 时要用响应里的）
    const q = new URLSearchParams({ mediaId });
    return { mediaId, key, uploadUrl: `/api/upload/image?${q}`, mime };
  }
  if (storageMode() === "oss") {
    return { mediaId, key, uploadUrl: ossPutUrl(key, mime), mime };
  }
  return { mediaId, key, uploadUrl: localDirectUrl(mediaId, mime, name), mime };
}

/** 第二步（local 模式）：PUT 进来的文件体落到本地 data/media */
export async function saveLocalDirect(mediaId: string, mime: string, name: string, buf: Buffer): Promise<string> {
  const ext = extFor(mime, name);
  const filename = `${mediaId}${ext}`;
  if (IS_DEMO) return filename; // 演示站：文件体直接丢弃，complete 入库时会换成样例
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(MEDIA_DIR, filename), buf);
  return filename;
}

/** 服务端转好的 JPEG 落位：local 写盘，oss 由服务端代传（用同一个签名规则） */
export async function storeJpegMedia(mediaId: string, buf: Buffer): Promise<string> {
  const key = objectKeyFor(mediaId, ".jpg");
  if (IS_DEMO) return key; // 演示站：不落盘，complete 时换样例
  if (storageMode() === "oss") {
    const putUrl = ossPutUrl(key, "image/jpeg");
    const res = await fetch(putUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array(buf),
    });
    if (!res.ok) throw new Error(`转好的图传 OSS 失败 (${res.status})`);
    return key;
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(MEDIA_DIR, `${mediaId}.jpg`), buf);
  return key;
}

export type CompleteInput = {
  mediaId: string;
  key: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  /** 视频是否 HEVC 编码（客户端嗅探，用于展示「电脑可能放不了」提示） */
  hevc?: boolean | null;
  /** 音频时长（秒）：录音时计时 / 导入文件时读元数据，气泡上展示用 */
  duration?: number | null;
  /** 自由拼贴页素材：不进相册、不算照片，只被 board 布局引用 */
  asset?: boolean;
  /** 贴纸库：长期保存复用，不挂在任何条目上 */
  sticker?: boolean;
  /** 内容指纹（大小-头尾sha256）：选文件时识别「已经传过」 */
  fingerprint?: string | null;
};

/** 第三步：上传完成后入库。filename 列在 oss 模式存对象 key */
export function completeMediaUpload(input: CompleteInput): MediaRow {
  const ext = extFor(input.mime, input.key);
  const expectedKey = objectKeyFor(input.mediaId, ext);
  if (input.key !== expectedKey) {
    throw new Error("对象 key 与登记不一致");
  }
  if (input.bytes <= 0 || input.bytes > MAX_UPLOAD_BYTES) {
    throw new Error("文件大小不合法");
  }
  const kind: MediaRow["kind"] = input.sticker
    ? "sticker"
    : input.asset
      ? "asset"
      : input.mime.startsWith("video/")
        ? "video"
        : input.mime.startsWith("audio/")
          ? "audio"
          : "photo";
  const row: MediaRow = {
    id: input.mediaId,
    entry_id: null,
    kind,
    mime: input.mime,
    filename: storageMode() === "oss" ? input.key : input.key.replace(/^media\//, ""),
    width: input.width && input.width > 0 ? input.width : null,
    height: input.height && input.height > 0 ? input.height : null,
    bytes: input.bytes,
    caption: null,
    sort: 0,
    live_video_id: null,
    hevc: input.hevc === true ? 1 : null,
    duration: input.duration && input.duration > 0 ? Math.round(input.duration * 10) / 10 : null,
    fingerprint: input.fingerprint && /^\d{1,13}-[a-f0-9]{64}$/.test(input.fingerprint) ? input.fingerprint : null,
    tags: null,
    created_at: nowISO(),
  };
  if (IS_DEMO) {
    // 演示站：用户传的文件体不保存，这条媒体指向样例素材（文件由 seed 放在 data/media）
    const sample = demoSampleFor(kind, input.mime);
    row.mime = sample.mime;
    row.filename = sample.filename;
    row.width = sample.width > 0 ? sample.width : null;
    row.height = sample.height > 0 ? sample.height : null;
    row.bytes = demoSampleBytes(sample);
    row.hevc = null;
    row.duration = sample.duration ?? null;
    row.fingerprint = null;
    db.prepare(
      `INSERT INTO media (id, entry_id, kind, mime, filename, width, height, bytes, caption, sort, live_video_id, hevc, duration, fingerprint, created_at)
       VALUES (@id, @entry_id, @kind, @mime, @filename, @width, @height, @bytes, @caption, @sort, @live_video_id, @hevc, @duration, @fingerprint, @created_at)`
    ).run(row);
    return row;
  }
  db.prepare(
    `INSERT INTO media (id, entry_id, kind, mime, filename, width, height, bytes, caption, sort, live_video_id, hevc, duration, fingerprint, created_at)
     VALUES (@id, @entry_id, @kind, @mime, @filename, @width, @height, @bytes, @caption, @sort, @live_video_id, @hevc, @duration, @fingerprint, @created_at)`
  ).run(row);
  // 照片顺手补一张缩略图、视频补一张封面、录音补时长（异步，不拖慢上传响应）
  if (row.kind === "photo" || row.kind === "video" || row.kind === "audio") void thumbAfterUpload(row);
  return row;
}

export function getMediaById(id: string): MediaRow | undefined {
  return db.prepare("SELECT * FROM media WHERE id = ?").get(id) as MediaRow | undefined;
}

/** 贴纸库：作者上传过的贴纸图，跨页面复用 */
export function listStickers(): MediaRow[] {
  return db.prepare("SELECT * FROM media WHERE kind = 'sticker' ORDER BY created_at DESC").all() as MediaRow[];
}

/** 某张贴纸是否还被拼贴页引用着（layout JSON 里出现它的 media id） */
export function stickerInUse(id: string): boolean {
  const row = db.prepare("SELECT COUNT(*) AS n FROM entries WHERE type = 'board' AND layout LIKE ?").get(`%"${id}"%`) as {
    n: number;
  };
  return row.n > 0;
}

export function mediaPath(row: MediaRow): string {
  return path.join(MEDIA_DIR, row.filename);
}

export async function deleteMediaFile(row: MediaRow): Promise<void> {
  db.prepare("DELETE FROM media WHERE id = ?").run(row.id);
  await deleteStoredObject(row.filename);
}

/** 删干净一张媒体：行 + 原文件 + 缩略图 + 视频封面（「本子里的一切」按张删除用） */
export async function deleteMediaCompletely(row: MediaRow): Promise<void> {
  if (row.kind === "photo") await deleteStoredObject(thumbKey(row.id)).catch(() => undefined);
  if (row.kind === "video") await deleteStoredObject(posterKey(row.id)).catch(() => undefined);
  await deleteMediaFile(row);
}

export function publicMedia(row: MediaRow, options: { direct?: boolean } = {}) {
  const direct = options.direct === true && storageMode() === "oss";
  const pair = direct && row.live_video_id ? getMediaById(row.live_video_id) : undefined;
  return {
    id: row.id,
    url: direct ? ossGetUrl(row.filename) : `/api/media/${row.id}`,
    /** 照片墙专用缩略图（480px WebP）；还没有时接口会自动回落原图 */
    thumbUrl: row.kind === "photo" ? (direct ? ossGetUrl(thumbKey(row.id)) : `/api/media/${row.id}?thumb=1`) : null,
    /** 视频封面（ffmpeg 抽的第一帧 480px JPG）：HEVC 视频浏览器解不出首帧，墙上一律用这张 */
    posterUrl: row.kind === "video" ? (direct ? ossGetUrl(posterKey(row.id)) : `/api/media/${row.id}?poster=1`) : null,
    kind: row.kind,
    mime: row.mime,
    width: row.width,
    height: row.height,
    caption: row.caption,
    liveVideo: row.live_video_id ? (pair ? ossGetUrl(pair.filename) : `/api/media/${row.live_video_id}`) : null,
    hevc: row.hevc === 1 ? true : null,
    duration: row.duration,
    sort: row.sort,
  };
}
