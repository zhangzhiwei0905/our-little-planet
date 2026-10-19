import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { createMilestone, listMilestones } from "@/lib/milestones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 大事记管理（作者）：列表 + 新增 */

export async function GET() {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先去 /write 输入作者口令" }, { status: 401 });
  }
  const milestones = listMilestones();
  return NextResponse.json({
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.title,
      body: m.body,
      date: m.date,
      icon: m.icon,
      mediaIds: m.media.map((x) => x.id),
    })),
  });
}

export async function POST(req: Request) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先去 /write 输入作者口令" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "参数不对" }, { status: 400 });
  try {
    const m = createMilestone(body);
    return NextResponse.json({
      milestone: { id: m.id, title: m.title, body: m.body, date: m.date, icon: m.icon, mediaIds: m.media.map((x) => x.id) },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存失败了" }, { status: 400 });
  }
}
