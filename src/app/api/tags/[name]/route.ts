import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { deleteTagEverywhere } from "@/lib/tagStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 全局删一个标签：标签库 + 所有照片/页面上的都一起撕掉 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  const { name } = await ctx.params;
  deleteTagEverywhere(decodeURIComponent(name));
  return NextResponse.json({ ok: true });
}
