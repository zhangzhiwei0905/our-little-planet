import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { deleteMilestone, setMilestoneVisibility, updateMilestone } from "@/lib/milestones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 大事记（作者）：改 / 删。照片视频留在相册，不受影响 */

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先去 /write 输入作者口令" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "参数不对" }, { status: 400 });

  // 列表上的快捷开关：只带 visibility 一个字段
  if (body.visibility === "public" || body.visibility === "private") {
    if (!body.title && !body.date) {
      setMilestoneVisibility(id, body.visibility);
      return NextResponse.json({ ok: true });
    }
  }
  try {
    const m = updateMilestone(id, body);
    return NextResponse.json({
      milestone: { id: m.id, title: m.title, body: m.body, date: m.date, icon: m.icon, mediaIds: m.media.map((x) => x.id) },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存失败了" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先去 /write 输入作者口令" }, { status: 401 });
  }
  const { id } = await ctx.params;
  deleteMilestone(id);
  return NextResponse.json({ ok: true });
}
