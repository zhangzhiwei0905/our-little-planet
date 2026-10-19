import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { deleteScreening, getScreening, setScreeningVisibility, updateScreening } from "@/lib/screenings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先去 /write 输入作者口令" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!getScreening(id)) return NextResponse.json({ error: "这场放映不存在" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "参数不对" }, { status: 400 });

  // 列表快捷开关：只带 visibility 一个字段
  if ((body.visibility === "public" || body.visibility === "private") && !body.title) {
    setScreeningVisibility(id, body.visibility);
    return NextResponse.json({ screening: getScreening(id) });
  }
  if (typeof body.title !== "string" || typeof body.premiereAt !== "string" || typeof body.mediaId !== "string") {
    return NextResponse.json({ error: "片名、首映日期和视频都要填" }, { status: 400 });
  }
  try {
    const s = await updateScreening(id, {
      title: body.title,
      subtitle: typeof body.subtitle === "string" ? body.subtitle : undefined,
      premiereAt: body.premiereAt,
      mediaId: body.mediaId,
      coverMediaId: typeof body.coverMediaId === "string" ? body.coverMediaId : undefined,
      visibility: body.visibility === "public" ? "public" : body.visibility === "private" ? "private" : undefined,
    });
    return NextResponse.json({ screening: s });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "没存上，再试一次？" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先去 /write 输入作者口令" }, { status: 401 });
  }
  const { id } = await ctx.params;
  await deleteScreening(id);
  return NextResponse.json({ ok: true });
}
