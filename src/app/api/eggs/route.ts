import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { createEgg, listEggs, doodleCounts } from "@/lib/eggs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  return NextResponse.json({
    eggs: listEggs().map((e) => {
      // Map 无法直接 JSON 序列化，转成普通对象
      const counts: Record<string, number> = {};
      for (const [pid, n] of doodleCounts(e.id)) counts[pid] = n;
      return { ...e, doodles: counts };
    }),
  });
}

export async function POST(req: Request) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "内容格式不对" }, { status: 400 });
  try {
    const egg = createEgg({
      title: String(body.title ?? ""),
      password: String(body.password ?? ""),
      revealDate: String(body.revealDate ?? ""),
      letter: String(body.letter ?? ""),
      photoIds: Array.isArray(body.photoIds) ? body.photoIds.map(String) : [],
    });
    return NextResponse.json({ egg });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "创建失败" }, { status: 400 });
  }
}
