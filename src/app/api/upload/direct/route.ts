import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { MAX_UPLOAD_BYTES, extFor, saveLocalDirect } from "@/lib/media";
import { storageMode } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 上传第二步（仅本地模式）：浏览器 PUT 文件体到服务器落盘。
 *  OSS 模式不走这里（直传 OSS），配置了 OSS 时此端点直接拒绝 */
export async function PUT(req: Request) {
  if (storageMode() === "oss") {
    return NextResponse.json({ error: "OSS 模式下请直传 OSS" }, { status: 400 });
  }
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先去 /write 输入作者口令" }, { status: 401 });
  }
  const url = new URL(req.url);
  const mediaId = url.searchParams.get("mediaId") ?? "";
  const mime = url.searchParams.get("mime") ?? "";
  const name = url.searchParams.get("name") ?? "";
  if (!/^[a-f0-9]{8,16}$/.test(mediaId)) {
    return NextResponse.json({ error: "mediaId 不合法" }, { status: 400 });
  }
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength <= 0 || buf.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "文件太大" }, { status: 413 });
  }
  extFor(mime, name); // 校验扩展名可解析
  const filename = await saveLocalDirect(mediaId, mime, name, buf);
  return NextResponse.json({ ok: true, key: `media/${filename}` });
}
