import { NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { quickTokenEnabled, quickTokenMatches } from "@/lib/quickToken";
import { IS_DEMO } from "@/lib/demo";
import { extFor, isAcceptedFile, MAX_UPLOAD_BYTES, normalizeMime } from "@/lib/media";
import { storageMode } from "@/lib/storage";
import { MEDIA_DIR } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 速记三步上传的第二步（仅本地存储模式）：手机把文件体 PUT 过来，
 *  请求流一边收一边落盘（带背压），内存占用恒定几 MB——
 *  和整包读进内存的 multipart 表单是两个世界。先写 .part 再改名，
 *  中途断线不会留下半个正式文件。 */
export async function PUT(req: Request) {
  if (!quickTokenEnabled()) {
    return NextResponse.json({ error: "服务器没有配置 SHORTCUT_TOKEN，速记通道未开启" }, { status: 503 });
  }
  if (!quickTokenMatches(req)) {
    return NextResponse.json({ error: "口令不对" }, { status: 401 });
  }
  if (storageMode() === "oss") {
    return NextResponse.json({ error: "OSS 模式下请直传 OSS，不走这个端点" }, { status: 400 });
  }
  const url = new URL(req.url);
  const mediaId = url.searchParams.get("mediaId") ?? "";
  const mime = url.searchParams.get("mime") ?? "";
  const name = url.searchParams.get("name") ?? "";
  if (!/^[a-f0-9]{8,16}$/.test(mediaId)) {
    return NextResponse.json({ error: "mediaId 不合法（先调 /api/quick/prepare 登记）" }, { status: 400 });
  }
  const normalized = normalizeMime(mime, name);
  if (!isAcceptedFile(normalized, name)) {
    return NextResponse.json({ error: `「${name}」不是支持的照片/视频/录音格式` }, { status: 415 });
  }
  const contentLength = Number(req.headers.get("content-length"));
  if (contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "文件太大（单文件最多 2GB）" }, { status: 413 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "请求体是空的" }, { status: 400 });
  }

  const filename = `${mediaId}${extFor(normalized, name)}`;
  const dest = path.join(MEDIA_DIR, filename);
  const part = `${dest}.part`;
  await unlink(part).catch(() => undefined); // 上一次中断留下的半截，清掉重来

  let received = 0;
  if (IS_DEMO) {
    // 演示站：收完就丢，不写盘（大小校验照做，登记时换样例）
    const drain = Readable.fromWeb(req.body as unknown as NodeWebReadableStream<Uint8Array>);
    try {
      for await (const chunk of drain) {
        received += chunk.byteLength;
        if (received > MAX_UPLOAD_BYTES) throw new Error("QUICK_FILE_TOO_LARGE");
      }
      if (received === 0) throw new Error("QUICK_FILE_EMPTY");
    } catch (e) {
      if (e instanceof Error && e.message === "QUICK_FILE_TOO_LARGE") {
        return NextResponse.json({ error: "文件太大（单文件最多 2GB）" }, { status: 413 });
      }
      if (e instanceof Error && e.message === "QUICK_FILE_EMPTY") {
        return NextResponse.json({ error: "请求体是空的" }, { status: 400 });
      }
      return NextResponse.json({ error: "保存上传文件失败" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, key: `media/${filename}`, bytes: received });
  }

  try {
    const source = Readable.fromWeb(req.body as unknown as NodeWebReadableStream<Uint8Array>);
    await pipeline(
      source,
      async function* guard(chunks: AsyncIterable<Uint8Array | Buffer>) {
        for await (const chunk of chunks) {
          received += chunk.byteLength;
          if (received > MAX_UPLOAD_BYTES) throw new Error("QUICK_FILE_TOO_LARGE");
          yield chunk as Buffer;
        }
      },
      createWriteStream(part)
    );
    if (received === 0) throw new Error("QUICK_FILE_EMPTY");
    await rename(part, dest);
  } catch (e) {
    await unlink(part).catch(() => undefined);
    if (e instanceof Error && e.message === "QUICK_FILE_TOO_LARGE") {
      return NextResponse.json({ error: "文件太大（单文件最多 2GB）" }, { status: 413 });
    }
    if (e instanceof Error && e.message === "QUICK_FILE_EMPTY") {
      return NextResponse.json({ error: "请求体是空的" }, { status: 400 });
    }
    return NextResponse.json({ error: "保存上传文件失败" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, key: `media/${filename}`, bytes: received });
}
