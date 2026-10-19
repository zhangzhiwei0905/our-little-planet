import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { listAllTags, upsertTags } from "@/lib/tagStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 全局标签库（作者）：输入回车就入库，所有选标签的地方都能选到 */
export async function GET() {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  return NextResponse.json({ tags: listAllTags() });
}

export async function POST(req: Request) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name : "";
  const clean = name.trim().slice(0, 20).trim();
  if (!clean) return NextResponse.json({ error: "标签不能是空的" }, { status: 400 });
  upsertTags([clean]);
  return NextResponse.json({ ok: true });
}
