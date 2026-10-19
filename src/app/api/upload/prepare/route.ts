import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { MAX_UPLOAD_BYTES, isAcceptedFile, prepareMediaUpload } from "@/lib/media";
import { storageMode } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LABEL = MAX_UPLOAD_BYTES >= 1024 * 1024 * 1024 ? `${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024 / 1024)}GB` : `${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`;

/** 上传第一步（作者）：登记待传文件，返回直传地址。
 *  OSS 模式 → 浏览器直接 PUT 到 OSS（带签名的临时 URL）；
 *  本地模式 → PUT 到 /api/upload/direct 中转落盘 */
export async function POST(req: Request) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先去 /write 输入作者口令" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { name?: string; mime?: string; size?: number } | null;
  if (!body || typeof body.name !== "string" || typeof body.mime !== "string") {
    return NextResponse.json({ error: "参数不对" }, { status: 400 });
  }
  if (typeof body.size === "number" && body.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `「${body.name}」太大了（单文件最多 ${MAX_LABEL}）` }, { status: 413 });
  }
  if (!isAcceptedFile(body.mime, body.name)) {
    return NextResponse.json({ error: `「${body.name}」不是支持的照片或视频格式` }, { status: 415 });
  }
  return NextResponse.json({ ...prepareMediaUpload(body.name, body.mime), mode: storageMode() });
}
