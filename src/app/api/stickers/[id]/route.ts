import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { deleteMediaFile, getMediaById, stickerInUse } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 从贴纸库删掉一张（作者）。还有拼贴页在用时不许删 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先去 /write 输入作者口令" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const row = getMediaById(id);
  if (!row || row.kind !== "sticker") {
    return NextResponse.json({ error: "贴纸库里没有这张" }, { status: 404 });
  }
  if (stickerInUse(id)) {
    return NextResponse.json({ error: "有拼贴页还在用这张贴纸，先在那边删掉它" }, { status: 409 });
  }
  await deleteMediaFile(row);
  return NextResponse.json({ ok: true });
}
