/** 快捷指令速记（/api/quick）的服务端实现：
 *  一次请求带上文字和文件，服务端完成 ZIP / livp 拆包、HEIC 转 JPEG、落存储、入库、
 *  同名照片+视频自动配对成 Live Photo，最后建好条目直接出现在语录墙 / 手帐里。
 *  和网页端「三步上传」殊途同归：都走 completeMediaUpload 入库、同名配对规则一致，
 *  指纹算法也和客户端相同（网页端可以识别快捷指令上传过的原文件）。
 *
 *  大视频另有「直传」通道，不走上面的整包表单（那会把几百 MB 读进内存）：
 *  /api/quick/prepare 先发直传地址（OSS 签名 PUT 或本地流式端点），手机传完文件后
 *  再 POST /api/quick 带 media[] 登记——这里的 completeStoredFile 只校验「确实传到了」
 *  并补指纹，全程不碰文件体。 */

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { MEDIA_DIR, type MediaRow } from "./db";
import { createEntry, type EntryInput, type EntryWithMedia } from "./entries";
import { heicToJpeg } from "./heic";
import { newId, todayLocal } from "./ids";
import {
  completeMediaUpload,
  extFor,
  isAcceptedFile,
  MAX_UPLOAD_BYTES,
  normalizeMime,
  probeMediaMeta,
} from "./media";
import { objectKeyFor, ossGetRange, ossPutUrl, ossStatObject, storageMode } from "./storage";
import { IS_DEMO } from "./demo";
import { prepareQuickFiles, planQuickMedia, QuickInputError, QUICK_MAX_MEDIA, type QuickFile } from "./quick-files";
export { QUICK_MAX_BYTES, QUICK_MAX_FILES, QuickInputError, type QuickFile } from "./quick-files";

export type QuickInput = {
  type: "quote" | "journal" | "photo";
  text: string;
  speaker?: string;
  title?: string;
  /** YYYY-MM-DD，缺省用服务器本地今天 */
  date?: string;
  /** 和请求一起发来的文件（multipart 表单路径） */
  files: QuickFile[];
  /** 已经直传到位的文件（/api/quick/prepare 三步路径的第三步登记） */
  stored?: QuickStoredFile[];
};

/** 已直传落位的文件：key 是 prepare 发下去的 media/<id><ext> */
export type QuickStoredFile = {
  key: string;
  /** 原文件名：同名照片+视频配对 Live Photo 用 */
  name: string;
  mime: string;
  bytes?: number;
};

export function isQuickAccepted(name: string, mime: string): boolean {
  return /\.(livp|zip)$/i.test(name) || isAcceptedFile(normalizeMime(mime, name), name);
}

/** 内容指纹：和 client-upload.ts 的 fileFingerprint 同一算法（大小-sha256(头512KB+尾512KB)） */
export function fingerprintOf(buf: Buffer): string {
  const HASH_SPAN = 524_288; // 512KB
  const bytes =
    buf.byteLength <= 1_048_576
      ? buf
      : Buffer.concat([buf.subarray(0, HASH_SPAN), buf.subarray(buf.byteLength - HASH_SPAN)]);
  return `${buf.byteLength}-${createHash("sha256").update(bytes).digest("hex")}`;
}

/** 落存储：local 返回写好的本地路径（探测元信息免得再拷一份临时文件），oss 返回 null */
async function storeBuffer(key: string, mime: string, buf: Buffer): Promise<string | null> {
  if (IS_DEMO) return null; // 演示站：文件体不落盘，入库时换样例
  if (storageMode() === "oss") {
    const res = await fetch(ossPutUrl(key, mime), {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: new Uint8Array(buf),
    });
    if (!res.ok) throw new Error(`文件传 OSS 失败 (${res.status})`);
    return null;
  }
  const p = path.join(MEDIA_DIR, key.replace(/^media\//, ""));
  await writeFile(p, buf);
  return p;
}

/** 单个文件走完整管线：转码（HEIC）→ 落存储 → completeMediaUpload 入库（缩略图/封面自动异步补） */
async function processFile(f: QuickFile): Promise<MediaRow> {
  const mime = normalizeMime(f.mime, f.name);
  const mediaId = newId();

  if (IS_DEMO) {
    // 演示站：不解码不探测不落盘，直接入库（completeMediaUpload 会换成样例素材）
    return completeMediaUpload({
      mediaId,
      key: objectKeyFor(mediaId, extFor(mime, f.name)),
      mime,
      bytes: f.buf.byteLength || 1,
    });
  }

  const fingerprint = fingerprintOf(f.buf);

  if (mime === "image/heic" || mime === "image/heif") {
    const jpg = await heicToJpeg(f.buf);
    const key = objectKeyFor(mediaId, ".jpg");
    await storeBuffer(key, "image/jpeg", jpg.buf);
    return completeMediaUpload({
      mediaId,
      key,
      mime: "image/jpeg",
      bytes: jpg.buf.length,
      width: jpg.width,
      height: jpg.height,
      fingerprint,
    });
  }

  const ext = extFor(mime, f.name);
  const key = objectKeyFor(mediaId, ext);
  const localPath = await storeBuffer(key, mime, f.buf);
  const meta: { width?: number; height?: number; hevc?: boolean; duration?: number } =
    mime.startsWith("video/") || mime.startsWith("audio/")
      ? await probeMediaMeta(localPath ?? f.buf)
      : await probeImageMeta(f.buf);
  return completeMediaUpload({
    mediaId,
    key,
    mime,
    bytes: f.buf.byteLength,
    width: meta.width,
    height: meta.height,
    hevc: meta.hevc ?? null,
    duration: meta.duration ?? null,
    fingerprint,
  });
}

/** sharp 读图片尺寸（best-effort，HEIC 不走这里——它已经转成 JPEG 且带尺寸） */
async function probeImageMeta(buf: Buffer): Promise<{ width?: number; height?: number }> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    return { width: meta.width ?? undefined, height: meta.height ?? undefined };
  } catch {
    return {};
  }
}

const KEY_RE = /^media\/([a-f0-9]{8,16})(\.[a-z0-9]+)$/i;

/** 直传文件的登记：确认真的传到了（OSS HEAD / 本地 stat），
 *  只拉头尾各 512KB 算指纹，时长/尺寸交给封面任务异步补齐 */
async function completeStoredFile(f: QuickStoredFile): Promise<MediaRow> {
  const mime = normalizeMime(f.mime, f.name);
  const m = KEY_RE.exec(f.key);
  if (!m) throw new QuickInputError(`直传文件的 key「${f.key}」不合法`, 400);
  const mediaId = m[1];
  if (f.key !== objectKeyFor(mediaId, extFor(mime, f.key))) {
    throw new QuickInputError(`「${f.name}」的文件类型和直传登记时不一致`, 400);
  }
  let bytes = f.bytes ?? 0;
  let fingerprint: string | null = null;
  if (IS_DEMO) {
    // 演示站：直传的文件体本来就丢弃，不用确认「传没传到」，登记完换样例
    return completeMediaUpload({ mediaId, key: f.key, mime, bytes: bytes > 0 ? bytes : 1 });
  }
  if (storageMode() === "oss") {
    const stat = await ossStatObject(f.key);
    if (!stat.exists) throw new QuickInputError(`「${f.name}」还没有上传成功（存储里找不到）`, 400);
    bytes = stat.bytes ?? bytes;
    fingerprint = await ossFingerprint(f.key, bytes);
  } else {
    const { stat } = await import("node:fs/promises");
    const p = path.join(MEDIA_DIR, f.key.replace(/^media\//, ""));
    const st = await stat(p).catch(() => null);
    if (!st?.isFile()) throw new QuickInputError(`「${f.name}」还没有上传成功（存储里找不到）`, 400);
    bytes = st.size;
    fingerprint = await localFingerprint(p, bytes);
  }
  if (bytes <= 0 || bytes > MAX_UPLOAD_BYTES) {
    throw new QuickInputError(`「${f.name}」的大小不合法`, 413);
  }
  return completeMediaUpload({ mediaId, key: f.key, mime, bytes, fingerprint });
}

/** 本地文件的指纹：只读头尾各 512KB（≤1MB 的整读） */
async function localFingerprint(filePath: string, size: number): Promise<string | null> {
  const { open } = await import("node:fs/promises");
  const HASH_SPAN = 524_288;
  const fh = await open(filePath, "r").catch(() => null);
  if (!fh) return null;
  try {
    if (size <= 1_048_576) {
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, 0);
      return fingerprintOf(buf);
    }
    const head = Buffer.alloc(HASH_SPAN);
    await fh.read(head, 0, HASH_SPAN, 0);
    const tail = Buffer.alloc(HASH_SPAN);
    await fh.read(tail, 0, HASH_SPAN, size - HASH_SPAN);
    return `${size}-${createHash("sha256").update(head).update(tail).digest("hex")}`;
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

/** OSS 对象的指纹：两个 Range GET 各拉 512KB，不用整份下载 */
async function ossFingerprint(key: string, size: number): Promise<string | null> {
  const HASH_SPAN = 524_288;
  if (size <= 1_048_576) {
    const whole = await ossGetRange(key, 0, size - 1);
    return whole ? fingerprintOf(whole) : null;
  }
  const head = await ossGetRange(key, 0, HASH_SPAN - 1);
  const tail = await ossGetRange(key, size - HASH_SPAN, size - 1);
  if (!head || !tail) return null;
  return `${size}-${createHash("sha256").update(head).update(tail).digest("hex")}`;
}

export async function quickCapture(input: QuickInput): Promise<EntryWithMedia> {
  const entryDate = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : todayLocal();
  // Validate the complete batch before storing any media.
  const plan = prepareQuickFiles(input.files.map((file) => ({
    ...file,
    mime: normalizeMime(file.mime, file.name),
  })));
  // 直传文件同样按「同名照片+视频」规则配对；zip / livp 不可能走到直传（prepare 会拒绝）
  const stored = input.stored ?? [];
  for (const s of stored) {
    if (/\.(zip|livp)$/i.test(s.name)) throw new QuickInputError(`「${s.name}」是压缩包，请直接发 /api/quick 表单`, 400);
  }
  const EMPTY = Buffer.alloc(0);
  const storedPlan =
    stored.length > 0
      ? planQuickMedia(stored.map((s) => ({ ...s, mime: normalizeMime(s.mime, s.name), buf: EMPTY })))
      : [];
  if (plan.length + storedPlan.length > QUICK_MAX_MEDIA) {
    throw new QuickInputError(`一次最多上传 ${QUICK_MAX_MEDIA} 项媒体，实况照片按一项计算`);
  }
  if (input.type === "photo") {
    const badFile = [...plan, ...storedPlan].find((item) => !/^(image|video)\//.test(item.file.mime));
    if (badFile) throw new QuickInputError("存相册只支持照片、实况照片和视频", 415);
  }
  const media: NonNullable<EntryInput["media"]> = [];
  for (const item of plan) {
    const photoOrVideo = await processFile(item.file);
    const liveVideo = item.liveVideo ? await processFile(item.liveVideo) : null;
    media.push({ id: photoOrVideo.id, sort: media.length, liveVideoId: liveVideo?.id ?? null });
  }
  for (const item of storedPlan) {
    const file = item.file as QuickStoredFile & QuickFile;
    const liveVideoFile = item.liveVideo as (QuickStoredFile & QuickFile) | undefined;
    const photoOrVideo = await completeStoredFile(file);
    const liveVideo = liveVideoFile ? await completeStoredFile(liveVideoFile) : null;
    media.push({ id: photoOrVideo.id, sort: media.length, liveVideoId: liveVideo?.id ?? null });
  }
  return createEntry({
    type: input.type,
    body: input.text,
    speaker: input.speaker?.trim() ? input.speaker.trim().slice(0, 40) : input.type === "quote" ? "她说" : undefined,
    title: input.title,
    entryDate,
    media,
  });
}
