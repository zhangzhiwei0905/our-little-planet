import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { completeMediaUpload, publicMedia } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 上传第三步（作者）：文件已就位（OSS 或本地），登记入库并返回 media 信息 */
export async function POST(req: Request) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先去 /write 输入作者口令" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as
    | { mediaId?: string; key?: string; mime?: string; bytes?: number; width?: number; height?: number; hevc?: boolean | null; duration?: number | null; asset?: boolean; sticker?: boolean; fingerprint?: string | null }
    | null;
  if (
    !body ||
    typeof body.mediaId !== "string" ||
    typeof body.key !== "string" ||
    typeof body.mime !== "string" ||
    typeof body.bytes !== "number"
  ) {
    return NextResponse.json({ error: "参数不对" }, { status: 400 });
  }
  try {
    const row = completeMediaUpload({
      mediaId: body.mediaId,
      key: body.key,
      mime: body.mime,
      bytes: body.bytes,
      width: body.width,
      height: body.height,
      hevc: body.hevc ?? null,
      duration: body.duration ?? null,
      asset: body.asset === true,
      sticker: body.sticker === true,
      fingerprint: body.fingerprint ?? null,
    });
    return NextResponse.json({ media: publicMedia(row) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "登记失败" }, { status: 400 });
  }
}
