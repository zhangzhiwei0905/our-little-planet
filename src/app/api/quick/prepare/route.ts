import { NextResponse } from "next/server";
import { quickTokenEnabled, quickTokenMatches } from "@/lib/quickToken";
import { extFor, MAX_UPLOAD_BYTES, normalizeMime } from "@/lib/media";
import { objectKeyFor, ossPutUrl, storageMode } from "@/lib/storage";
import { newId } from "@/lib/ids";
import { isQuickAccepted } from "@/lib/quickCapture";
import { QUICK_MAX_FILES } from "@/lib/quick-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 速记三步上传的第一步：登记文件、发直传地址。
 *  OSS 模式 → 手机拿着签名 URL 直接 PUT 到 OSS（几百 MB 的视频完全不经过服务器）；
 *  本地模式 → PUT 到 /api/quick/file 流式落盘（内存恒定，不整包缓冲）。
 *  ZIP / livp 要服务端拆解、HEIC 要服务端转 JPEG，这三类不发直传地址
 *  （direct: false + 原因），快捷指令应继续走 /api/quick 的 multipart 表单。 */
export async function POST(req: Request) {
  if (!quickTokenEnabled()) {
    return NextResponse.json({ error: "服务器没有配置 SHORTCUT_TOKEN，速记通道未开启" }, { status: 503 });
  }
  if (!quickTokenMatches(req)) {
    return NextResponse.json({ error: "口令不对" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { files?: unknown } | null;
  const rawFiles = Array.isArray(body?.files) ? body!.files : [];
  if (rawFiles.length === 0) {
    return NextResponse.json({ error: "files 不能为空" }, { status: 400 });
  }
  if (rawFiles.length > QUICK_MAX_FILES) {
    return NextResponse.json({ error: `一次最多登记 ${QUICK_MAX_FILES} 个文件` }, { status: 400 });
  }

  const out: {
    name: string;
    direct: boolean;
    reason?: string;
    mediaId?: string;
    key?: string;
    mime?: string;
    uploadUrl?: string;
  }[] = [];

  for (const raw of rawFiles) {
    const f = raw as { name?: unknown; mime?: unknown; size?: unknown };
    const name = typeof f.name === "string" ? f.name.trim() : "";
    if (!name) return NextResponse.json({ error: "每个文件都要有文件名" }, { status: 400 });
    const mime = normalizeMime(typeof f.mime === "string" ? f.mime : "", name);
    if (!isQuickAccepted(name, mime)) {
      return NextResponse.json({ error: `「${name}」不是支持的照片/视频/录音格式` }, { status: 415 });
    }
    if (typeof f.size === "number" && f.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: `「${name}」太大了（单文件最多 2GB）` }, { status: 413 });
    }
    if (/\.(zip|livp)$/i.test(name) || mime === "image/heic" || mime === "image/heif") {
      out.push({
        name,
        direct: false,
        reason: /\.(zip|livp)$/i.test(name) ? "压缩包需要服务端拆解" : "HEIC 照片需要服务端转成 JPEG",
      });
      continue;
    }
    const mediaId = newId();
    const ext = extFor(mime, name);
    const key = objectKeyFor(mediaId, ext);
    out.push({
      name,
      direct: true,
      mediaId,
      key,
      mime,
      uploadUrl:
        storageMode() === "oss"
          ? ossPutUrl(key, mime, 900)
          : `/api/quick/file?${new URLSearchParams({ mediaId, mime, name })}`,
    });
  }

  return NextResponse.json({ mode: storageMode(), files: out });
}
