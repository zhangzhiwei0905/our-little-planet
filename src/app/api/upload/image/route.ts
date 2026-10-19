import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { heicToJpeg } from "@/lib/heic";
import { MAX_UPLOAD_BYTES, storeJpegMedia } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** HEIC/HEIF 中转上传（作者）：浏览器把原图 PUT 过来，服务端解码成 JPEG——
 *  桌面 Chrome/Firefox 显示不了 HEIC，Safari 能解的会在浏览器里先转一道，转不了的就走这里。
 *  local 模式落盘，oss 模式由服务端代传 OSS；响应返回修正后的 key/mime/bytes/尺寸，
 *  客户端拿它们去 complete 入库 */
export async function PUT(req: Request) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先去 /write 输入作者口令" }, { status: 401 });
  }
  const mediaId = new URL(req.url).searchParams.get("mediaId") ?? "";
  if (!/^[a-f0-9]{8,16}$/.test(mediaId)) {
    return NextResponse.json({ error: "mediaId 不合法" }, { status: 400 });
  }
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength <= 0 || buf.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "文件太大" }, { status: 413 });
  }
  try {
    const jpg = await heicToJpeg(buf);
    const key = await storeJpegMedia(mediaId, jpg.buf);
    return NextResponse.json({
      key,
      mime: "image/jpeg",
      bytes: jpg.buf.length,
      width: jpg.width,
      height: jpg.height,
    });
  } catch {
    return NextResponse.json({ error: "这张 HEIC 解不开，试试重新导出一次再传" }, { status: 422 });
  }
}
