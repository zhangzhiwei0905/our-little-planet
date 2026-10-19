import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { deleteEgg, getEgg, updateEgg } from "@/lib/eggs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!getEgg(id)) return NextResponse.json({ error: "这个彩蛋不存在" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "内容格式不对" }, { status: 400 });
  try {
    const egg = updateEgg(id, {
      title: String(body.title ?? ""),
      password: String(body.password ?? ""),
      revealDate: String(body.revealDate ?? ""),
      letter: String(body.letter ?? ""),
      photoIds: Array.isArray(body.photoIds) ? body.photoIds.map(String) : [],
    });
    return NextResponse.json({ egg });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存失败" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  const { id } = await ctx.params;
  deleteEgg(id);
  return NextResponse.json({ ok: true });
}
