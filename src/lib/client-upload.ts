"use client";

/** 客户端三步上传：prepare 拿直传地址 → PUT 文件（HEIC 走服务端中转转 JPEG）→ complete 入库。
 *  返回的 MediaDTO 里 url 是 /api/media/<id>（带鉴权）。 */

/** 单文件上限（和 src/lib/media.ts 的 MAX_UPLOAD_BYTES 保持一致；媒体库不能进客户端包，只好镜像一份） */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "2GB";

/** 内容指纹：「大小-sha256(头512KB+尾512KB)」。≤1MB 的文件直接整段哈希。
 *  用来识别「这个文件已经传过了」——同一份原文件（哪怕 HEIC 被服务端转成 JPG）指纹不变 */
export async function fileFingerprint(file: File): Promise<string> {
  try {
    const HASH_SPAN = 524_288; // 512KB
    let bytes: Uint8Array;
    if (file.size <= 1_048_576) {
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const head = new Uint8Array(await file.slice(0, HASH_SPAN).arrayBuffer());
      const tail = new Uint8Array(await file.slice(file.size - HASH_SPAN).arrayBuffer());
      bytes = new Uint8Array(head.length + tail.length);
      bytes.set(head, 0);
      bytes.set(tail, head.length);
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${file.size}-${hex}`;
  } catch {
    return "";
  }
}

/** 按指纹查哪些文件已经传过；返回 指纹 -> 已有媒体（没传过的不在结果里） */
export async function lookupFingerprints(fps: string[]): Promise<Record<string, { id: string; kind: "photo" | "video"; thumbUrl: string | null; entryDate: string | null; caption: string | null }>> {
  const valid = fps.filter((f) => f);
  if (valid.length === 0) return {};
  try {
    const res = await fetch("/api/media/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fps: [...new Set(valid)].slice(0, 500) }),
    });
    if (!res.ok) return {};
    return ((await res.json()) as { found: Record<string, { id: string; kind: "photo" | "video"; thumbUrl: string | null; entryDate: string | null; caption: string | null }> }).found ?? {};
  } catch {
    return {};
  }
}

export type MediaDTO = {
  id: string;
  url: string;
  /** 照片墙用的 480px WebP 缩略图（没有时回落原图） */
  thumbUrl?: string | null;
  /** 视频封面（ffmpeg 抽的第一帧 480px JPG） */
  posterUrl?: string | null;
  kind: "photo" | "video" | "asset" | "sticker" | "audio";
  mime: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  liveVideo: string | null;
  hevc?: boolean | null;
  /** 音频时长（秒） */
  duration?: number | null;
  /** true = 从相册引用来的（条目不拥有它） */
  ref?: boolean;
};

/** 大图先在浏览器里压一遍再上传。
 *  HEIC 也试着走这里：Safari / 新版 Chrome 能解就直接转成 JPG，
 *  解不了（老 Chrome、Firefox）就原样上传，服务端会转成 JPEG */
export async function shrinkImage(file: File): Promise<{ file: File; width: number; height: number }> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") {
    return { file, width: 0, height: 0 };
  }
  try {
    const bmp = await createImageBitmap(file);
    const { width, height } = bmp;
    const meta = { width, height };
    if (file.size < 350_000) {
      bmp.close();
      return { file, ...meta };
    }
    const scale = Math.min(1, 2000 / Math.max(width, height));
    if (scale >= 1) {
      bmp.close();
      return { file, ...meta };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return { file, ...meta };
    return {
      file: new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }),
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    return { file, width: 0, height: 0 };
  }
}

/** livp 里常见成员的 MIME（File 构造用） */
const LIVP_MIME: Record<string, string> = {
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
};

/** 拆开 iPhone 导出的 .livp（本质是个 zip：一张 HEIC + 一段 MOV）。
 *  拆出的两个文件用 livp 的文件名做同名基底——正好走「同名自动配对成 Live Photo」；
 *  文件名里的拍摄日期（如 2026-08-19 235022.livp）也一并保留给日期解析用。
 *  拆不出照片/视频时返回空数组。 */
export async function expandLivp(file: File): Promise<File[]> {
  if (!/\.livp$/i.test(file.name)) return [file];
  const { unzipSync } = await import("fflate");
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const base = file.name.replace(/\.livp$/i, "");
  let photo: { data: Uint8Array; ext: string } | null = null;
  let video: { data: Uint8Array; ext: string } | null = null;
  for (const [name, data] of Object.entries(entries)) {
    if (name.startsWith("__MACOSX") || name.startsWith(".") || name.endsWith("/")) continue;
    const ext = (name.match(/\.(heic|heif|jpe?g|png|webp|mov|mp4|m4v)$/i) ?? [])[0]?.toLowerCase();
    if (!ext) continue;
    if (/^\.(mov|mp4|m4v)$/.test(ext)) {
      if (!video) video = { data, ext };
    } else if (!photo) {
      photo = { data, ext: ext === ".jpeg" ? ".jpg" : ext };
    }
  }
  const out: File[] = [];
  /** fflate 给的是 Uint8Array<ArrayBufferLike>，File 构造要 ArrayBuffer，拷一份顺便收窄类型 */
  const toPart = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
  if (photo) out.push(new File([toPart(photo.data)], `${base}${photo.ext}`, { type: LIVP_MIME[photo.ext] ?? "application/octet-stream" }));
  if (video) out.push(new File([toPart(video.data)], `${base}${video.ext}`, { type: LIVP_MIME[video.ext] ?? "application/octet-stream" }));
  return out;
}

function xhrPut(
  url: string,
  file: File,
  mime: string,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", mime);
    // 卡死看门狗：75 秒没有任何字节进账就掐断连接。
    // 之前没有它，一个挂起的 PUT 会永远占着并发闸门，整批上传就冻住了（大文件没事，进度事件会喂狗）
    const STALL_MS = 75_000;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const feedDog = () => {
      if (stallTimer !== null) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => xhr.abort(), STALL_MS);
    };
    feedDog();
    const onAbort = () => {
      if (stallTimer !== null) clearTimeout(stallTimer);
      signal?.removeEventListener("abort", onAbort);
      xhr.abort();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.upload.onprogress = (e) => {
      feedDog();
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (stallTimer !== null) clearTimeout(stallTimer);
      if (xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Record<string, unknown>);
        } catch {
          resolve(null);
        }
      } else {
        try {
          const j = JSON.parse(xhr.responseText);
          reject(new Error(j.error ?? `上传失败 (${xhr.status})`));
        } catch {
          reject(new Error(`上传失败 (${xhr.status})`));
        }
      }
    };
    xhr.onerror = () => reject(new Error("网络不好，上传失败"));
    xhr.onabort = () => reject(signal?.aborted ? new Error("已取消") : new Error("上传卡住了（网络不通？），稍后重试"));
    xhr.send(file);
  });
}

/** 带一次自动重试的请求：网络抖一下不用用户手点「重传」 */
async function retryable<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (signal?.aborted) throw e;
    return await fn();
  }
}

function timedSignal(ms: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function uploadFile(
  file: File,
  opts: {
    width?: number;
    height?: number;
    hevc?: boolean | null;
    /** 音频时长（秒），语录语音气泡上展示 */
    duration?: number | null;
    /** 自由拼贴页素材：不进相册 */
    asset?: boolean;
    /** 贴纸库：长期保存复用 */
    sticker?: boolean;
    onProgress?: (loaded: number) => void;
    /** 选中后又移除时中止上传 */
    signal?: AbortSignal;
    /** 内容指纹（去重用），随 complete 入库 */
    fingerprint?: string;
  } = {}
): Promise<MediaDTO> {
  // prepare/complete 各带 30s 超时和一次自动重试；PUT 有卡死看门狗 + 自动重试。
  // 400 个文件的批量上传里网络抖一下很正常，不能让用户挨个点「重传」
  const prepRes = await retryable(() =>
    fetch("/api/upload/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, mime: file.type || "application/octet-stream", size: file.size }),
      signal: timedSignal(30_000, opts.signal),
    })
  , opts.signal);
  const prep = (await prepRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!prepRes.ok) throw new Error((prep.error as string) ?? "准备上传失败");
  const put = await retryable(
    () => xhrPut(prep.uploadUrl as string, file, prep.mime as string, opts.onProgress ?? (() => undefined), opts.signal),
    opts.signal
  );
  const doneRes = await retryable(() =>
    fetch("/api/upload/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaId: prep.mediaId,
        key: (put?.key as string) ?? prep.key,
        mime: (put?.mime as string) ?? prep.mime,
        bytes: (put?.bytes as number) ?? file.size,
        width: (put?.width as number) ?? opts.width ?? 0,
        height: (put?.height as number) ?? opts.height ?? 0,
        hevc: opts.hevc ?? undefined,
        duration: opts.duration ?? undefined,
        asset: opts.asset === true,
        sticker: opts.sticker === true,
        fingerprint: opts.fingerprint || undefined,
      }),
      signal: timedSignal(30_000, opts.signal),
    })
  , opts.signal);
  const done = (await doneRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!doneRes.ok) throw new Error((done.error as string) ?? "登记失败");
  return done.media as MediaDTO;
}
