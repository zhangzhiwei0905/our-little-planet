import { NextResponse } from "next/server";
import { isAuthor } from "@/lib/auth";
import { saveSettings, type SiteSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Partial<SiteSettings> | null;
  if (!body) return NextResponse.json({ error: "内容格式不对" }, { status: 400 });
  if (body.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
    return NextResponse.json({ error: "纪念日日期格式不对" }, { status: 400 });
  }
  if (body.somedayDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.somedayDate)) {
    return NextResponse.json({ error: "Someday 揭晓日期格式不对" }, { status: 400 });
  }
  if (body.bgmMediaId && !/^[a-f0-9]{8,16}$/.test(body.bgmMediaId)) {
    return NextResponse.json({ error: "背景音乐文件不对，重新上传一次" }, { status: 400 });
  }
  if (body.bgmTitle && body.bgmTitle.length > 120) {
    return NextResponse.json({ error: "歌名太长了（120 字以内）" }, { status: 400 });
  }
  if (body.bgmLyrics && body.bgmLyrics.length > 20000) {
    return NextResponse.json({ error: "歌词太长了" }, { status: 400 });
  }
  // 访客模式：栏目开关只认 "0"/"1"，欢迎语限长
  for (const k of ["guestHome", "guestJournal", "guestAlbum", "guestQuotes", "guestLetters", "guestTimeline", "guestScreenings"] as const) {
    if (body[k] !== undefined && body[k] !== "0" && body[k] !== "1") {
      return NextResponse.json({ error: "栏目开关的值不对" }, { status: 400 });
    }
  }
  if (body.guestWelcome && body.guestWelcome.length > 200) {
    return NextResponse.json({ error: "访客欢迎语太长了（200 字以内）" }, { status: 400 });
  }
  return NextResponse.json({ settings: saveSettings(body) });
}
