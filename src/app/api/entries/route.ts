import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { createEntry, listEntries, type EntryInput } from "@/lib/entries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  // 作者视角：草稿和定时未到的都看得到
  return NextResponse.json({ entries: listEntries({ includeDrafts: true }) });
}

export async function POST(req: Request) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as EntryInput | null;
  if (!body || typeof body.body !== "string") {
    return NextResponse.json({ error: "内容格式不对" }, { status: 400 });
  }
  try {
    const entry = createEntry(body);
    return NextResponse.json({ entry });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存失败了" }, { status: 400 });
  }
}
