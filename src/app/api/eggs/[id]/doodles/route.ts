import { NextResponse } from "next/server";
import { isEggUnlocked } from "@/lib/auth";
import { getEgg, listDoodles, saveDoodle, type EggDoodle } from "@/lib/eggs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 读某张照片上的留言：凭这个彩蛋的解锁身份（作者预览或她输过彩蛋密码），
 *  不要求手账读者密码——彩蛋链接是独立的礼物 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const egg = getEgg(id);
  if (!egg) return new NextResponse("Not Found", { status: 404 });
  if (!(await isEggUnlocked(id))) return new NextResponse("Not Found", { status: 404 });
  const photoId = new URL(req.url).searchParams.get("photoId") ?? undefined;
  return NextResponse.json({ doodles: listDoodles(id, photoId) });
}

/** 她在照片上画的话，存到服务器（作者后台能看到） */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const egg = getEgg(id);
  if (!egg) return new NextResponse("Not Found", { status: 404 });
  if (!(await isEggUnlocked(id))) {
    return NextResponse.json({ error: "先拆开这个彩蛋" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { photoId?: string; strokes?: EggDoodle["strokes"] } | null;
  if (!body?.photoId || !Array.isArray(body.strokes)) {
    return NextResponse.json({ error: "内容格式不对" }, { status: 400 });
  }
  // 照片必须属于这个彩蛋
  if (!egg.photoIds.includes(body.photoId)) {
    return NextResponse.json({ error: "这张照片不在这个彩蛋里" }, { status: 400 });
  }
  try {
    const doodle = saveDoodle(id, body.photoId, body.strokes);
    return NextResponse.json({ doodle });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存失败" }, { status: 400 });
  }
}
