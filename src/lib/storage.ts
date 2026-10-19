import { createHmac } from "node:crypto";
import path from "node:path";

/**
 * 存储抽象：本地文件夹 / 阿里云 OSS 私有桶 双模式。
 * OSS 模式下：上传走浏览器 PUT 签名直传（不占服务器带宽），
 * 读取走 /api/media/[id] 302 到带签名的临时 URL，删除走服务端签名 DELETE。
 * 签名全部手写（OSS V1 签名，HMAC-SHA1），零 SDK 依赖。
 */

export type StorageMode = "local" | "oss";

const OSS_BUCKET = process.env.OSS_BUCKET ?? "";
const OSS_ACCESS_KEY_ID = process.env.OSS_ACCESS_KEY_ID ?? "";
const OSS_ACCESS_KEY_SECRET = process.env.OSS_ACCESS_KEY_SECRET ?? "";
// endpoint 形如 oss-cn-hangzhou.aliyuncs.com（可省略 bucket 前缀，代码自己拼）
const OSS_ENDPOINT = (process.env.OSS_ENDPOINT ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");

export function storageMode(): StorageMode {
  return OSS_BUCKET && OSS_ACCESS_KEY_ID && OSS_ACCESS_KEY_SECRET && OSS_ENDPOINT ? "oss" : "local";
}

function assertOss() {
  if (storageMode() !== "oss") {
    throw new Error("OSS 未配置：请在 .env.local 填 OSS_BUCKET / OSS_ENDPOINT / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET");
  }
}

export function objectKeyFor(mediaId: string, ext: string): string {
  return `media/${mediaId}${ext}`;
}

/** OSS V1 签名：base64(hmac-sha1(AccessKeySecret, StringToSign)) */
function ossSignature(verb: string, contentType: string, expires: number, key: string): string {
  const resource = `/${OSS_BUCKET}/${key}`;
  const stringToSign = `${verb}\n\n${contentType}\n${expires}\n${resource}`;
  return createHmac("sha1", OSS_ACCESS_KEY_SECRET).update(stringToSign).digest("base64");
}

/** 生成 PUT 直传 URL（浏览器 fetch(url, {method:'PUT', body:file, headers:{'Content-Type': mime}})）。
 *  注意：请求的 Content-Type 必须与签名一致 */
export function ossPutUrl(key: string, mime: string, expiresSec = 600): string {
  assertOss();
  const expires = Math.floor(Date.now() / 1000) + expiresSec;
  const sig = ossSignature("PUT", mime, expires, key);
  const q = new URLSearchParams({
    OSSAccessKeyId: OSS_ACCESS_KEY_ID,
    Expires: String(expires),
    Signature: sig,
  });
  return `https://${OSS_BUCKET}.${OSS_ENDPOINT}/${key}?${q}`;
}

/** 生成 GET 下载 URL（私有桶，临时授权） */
export function ossGetUrl(key: string, expiresSec = 3600): string {
  assertOss();
  const expires = Math.floor(Date.now() / 1000) + expiresSec;
  const sig = ossSignature("GET", "", expires, key);
  const q = new URLSearchParams({
    OSSAccessKeyId: OSS_ACCESS_KEY_ID,
    Expires: String(expires),
    Signature: sig,
  });
  return `https://${OSS_BUCKET}.${OSS_ENDPOINT}/${key}?${q}`;
}

/** 服务端签名 DELETE（删条目时同步删 OSS 对象） */
export async function ossDeleteObject(key: string): Promise<void> {
  assertOss();
  const expires = Math.floor(Date.now() / 1000) + 60;
  const sig = ossSignature("DELETE", "", expires, key);
  const q = new URLSearchParams({
    OSSAccessKeyId: OSS_ACCESS_KEY_ID,
    Expires: String(expires),
    Signature: sig,
  });
  await fetch(`https://${OSS_BUCKET}.${OSS_ENDPOINT}/${key}?${q}`, { method: "DELETE" }).catch(() => undefined);
}

/** 进程内缓存 OSS 变体状态，避免每次刷新都为同一张缩略图重复 HEAD。 */
const knownMissing = new Map<string, number>();
const knownExisting = new Map<string, number>();
const VARIANT_CACHE_MS = 5 * 60 * 1000;

/** OSS 对象的 HEAD 信息：{ exists, bytes }。网络失败按不存在处理（complete 登记时用） */
export async function ossStatObject(key: string): Promise<{ exists: boolean; bytes: number | null }> {
  if (storageMode() !== "oss") return { exists: false, bytes: null };
  const expires = Math.floor(Date.now() / 1000) + 60;
  const sig = ossSignature("HEAD", "", expires, key);
  const q = new URLSearchParams({
    OSSAccessKeyId: OSS_ACCESS_KEY_ID,
    Expires: String(expires),
    Signature: sig,
  });
  const res = await fetch(`https://${OSS_BUCKET}.${OSS_ENDPOINT}/${key}?${q}`, {
    method: "HEAD",
  }).catch(() => null);
  if (!res || !res.ok) return { exists: false, bytes: null };
  const len = Number(res.headers.get("content-length"));
  return { exists: true, bytes: Number.isFinite(len) ? len : null };
}

/** 按区间拉取 OSS 对象的一段字节（V1 签名 GET 对 Range 头不敏感）：
 *  只取头尾各 512KB 算内容指纹，不用为几百 MB 的视频付整份下载 */
export async function ossGetRange(key: string, start: number, endInclusive: number): Promise<Buffer | null> {
  if (storageMode() !== "oss") return null;
  const expires = Math.floor(Date.now() / 1000) + 120;
  const sig = ossSignature("GET", "", expires, key);
  const q = new URLSearchParams({
    OSSAccessKeyId: OSS_ACCESS_KEY_ID,
    Expires: String(expires),
    Signature: sig,
  });
  const res = await fetch(`https://${OSS_BUCKET}.${OSS_ENDPOINT}/${key}?${q}`, {
    headers: { Range: `bytes=${start}-${endInclusive}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/** OSS 对象是否存在（HEAD + 负缓存；网络失败按不存在处理，走原有兜底） */
export async function ossObjectExists(key: string): Promise<boolean> {
  if (storageMode() !== "oss") return false;
  const now = Date.now();
  const missingUntil = knownMissing.get(key);
  if (missingUntil && missingUntil > now) return false;
  if (missingUntil) knownMissing.delete(key);
  const existingUntil = knownExisting.get(key);
  if (existingUntil && existingUntil > now) return true;
  if (existingUntil) knownExisting.delete(key);
  const expires = Math.floor(Date.now() / 1000) + 60;
  const sig = ossSignature("HEAD", "", expires, key);
  const q = new URLSearchParams({
    OSSAccessKeyId: OSS_ACCESS_KEY_ID,
    Expires: String(expires),
    Signature: sig,
  });
  const res = await fetch(`https://${OSS_BUCKET}.${OSS_ENDPOINT}/${key}?${q}`, {
    method: "HEAD",
  }).catch(() => null);
  const ok = Boolean(res && res.ok);
  if (!ok) knownMissing.set(key, now + VARIANT_CACHE_MS);
  else {
    knownMissing.delete(key);
    knownExisting.set(key, now + VARIANT_CACHE_MS);
  }
  return ok;
}

/** 统一删除入口：按当前模式删本地文件或 OSS 对象。
 *  media.filename：local 模式存文件名，oss 模式存对象 key */
export async function deleteStoredObject(filename: string): Promise<void> {
  if (storageMode() === "oss") {
    await ossDeleteObject(filename);
  } else {
    const { unlink } = await import("node:fs/promises");
    await unlink(path.join(process.cwd(), "data", "media", filename)).catch(() => undefined);
  }
}

/** 本地直传端点（local 模式下替代 OSS 的 PUT 目标） */
export function localDirectUrl(mediaId: string, mime: string, name: string): string {
  const q = new URLSearchParams({ mediaId, mime, name });
  return `/api/upload/direct?${q}`;
}
