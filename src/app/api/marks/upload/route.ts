import path from "node:path";
import { NextResponse } from "next/server";
import { isReader } from "@/lib/auth";
import { IS_DEMO } from "@/lib/demo";
import { completeMediaUpload } from "@/lib/media";
import { objectKeyFor, ossPutUrl, storageMode } from "@/lib/storage";
import { newId } from "@/lib/ids";
import { MEDIA_DIR } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 评论配图上限：10MB 原图，服务端压到 1600px JPEG（GIF 表情包保持原样不动） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 她发评论用的图片上传（读者即可）：multipart 一张图，
 *  服务端统一转 JPEG 压好再入库（GIF 直存保住表情包的动），
 *  返回 /api/media 地址；图片在评论保存时才被「认领」，之前是孤儿行 */
export async function POST(req: Request) {
  if (!(await isReader())) {
    return NextResponse.json({ error: "本子还锁着" }, { status: 401 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "没收到图片" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "图太大了（10MB 以内）" }, { status: 413 });
  }
  const mime = file.type || "application/octet-stream";
  if (!mime.startsWith("image/") || mime === "image/svg+xml") {
    return NextResponse.json({ error: "只能传图片哦" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const isGif = mime === "image/gif";
  let outBuf = buf;
  let outMime = mime;
  let width = 0;
  let height = 0;

  if (IS_DEMO) {
    // 演示站：不压图不落盘，completeMediaUpload 会把这条换成样例素材（GIF 也换会动的样例 GIF）
  } else if (!isGif) {
    // 统一转 JPEG：去掉 EXIF 方向问题、控制大小（HEIC 解不开就报错让她换个格式）
    try {
      const sharp = (await import("sharp")).default;
      const resized = await sharp(buf)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      outBuf = resized.data;
      outMime = "image/jpeg";
      width = resized.info.width;
      height = resized.info.height;
    } catch {
      return NextResponse.json({ error: "这张图解不开，试试导出成 JPG 再传" }, { status: 422 });
    }
  }

  const mediaId = newId();
  const ext = isGif ? ".gif" : ".jpg";
  const key = objectKeyFor(mediaId, ext);
  if (!IS_DEMO) {
    try {
      if (storageMode() === "oss") {
        const putUrl = ossPutUrl(key, outMime);
        const res = await fetch(putUrl, { method: "PUT", headers: { "Content-Type": outMime }, body: new Uint8Array(outBuf) });
        if (!res.ok) throw new Error(`传 OSS 失败 (${res.status})`);
      } else {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path.join(MEDIA_DIR, `${mediaId}${ext}`), outBuf);
      }
    } catch {
      return NextResponse.json({ error: "没传上，再试一次？" }, { status: 500 });
    }
  }

  const row = completeMediaUpload({
    mediaId,
    key,
    mime: outMime,
    bytes: outBuf.length,
    width,
    height,
  });
  // completeMediaUpload 会异步补缩略图（GIF 取第一帧），这里不用再做

  return NextResponse.json({
    id: row.id,
    url: `/api/media/${row.id}`,
    thumbUrl: `/api/media/${row.id}?thumb=1`,
  });
}
