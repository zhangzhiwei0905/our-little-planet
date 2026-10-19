import { NextResponse } from "next/server";
import { isReader } from "@/lib/auth";
import { getEntry } from "@/lib/entries";
import { getScreening, premiered } from "@/lib/screenings";
import { addReply, repliesFor, stampSeen } from "@/lib/marks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 她留下的痕迹：盖章（seen）/ 评论（reply）。读者锁后面，谁翻开本子谁就能留；
 *  挂靠对象可以是手账页/信，也可以是放映室的一场首映（观后感） */
export async function POST(req: Request) {
  if (!(await isReader())) {
    return NextResponse.json({ error: "本子还锁着" }, { status: 401 });
  }
  const { entryId, kind, body, mediaIds } = (await req.json().catch(() => ({}))) as {
    entryId?: string;
    kind?: string;
    body?: string;
    mediaIds?: unknown;
  };
  if (typeof entryId !== "string" || !/^[a-f0-9]{8,16}$/.test(entryId)) {
    return NextResponse.json({ error: "这一页不存在" }, { status: 400 });
  }
  const entry = getEntry(entryId);
  const screening = entry ? undefined : getScreening(entryId);
  if (!entry && !screening) {
    return NextResponse.json({ error: "这一页不存在" }, { status: 404 });
  }
  if (entry && entry.published !== 1) {
    return NextResponse.json({ error: "这一页不存在" }, { status: 404 });
  }
  // 未首映的场次不留痕迹（页面也不该出现，这里兜底）
  if (screening && !premiered(screening)) {
    return NextResponse.json({ error: "这场还没首映哦" }, { status: 400 });
  }

  if (kind === "seen") {
    const createdAt = stampSeen(entryId);
    return NextResponse.json({ ok: true, createdAt });
  }
  if (kind === "reply") {
    const ids = Array.isArray(mediaIds) ? mediaIds.filter((x): x is string => typeof x === "string") : [];
    try {
      const reply = addReply(entryId, body ?? "", ids);
      return NextResponse.json({ ok: true, reply });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "没存上，再试一次？" }, { status: 400 });
    }
  }
  return NextResponse.json({ error: "不认识这种痕迹" }, { status: 400 });
}

/** 拉某一页（或某场放映）的评论 */
export async function GET(req: Request) {
  if (!(await isReader())) {
    return NextResponse.json({ error: "本子还锁着" }, { status: 401 });
  }
  const entryId = new URL(req.url).searchParams.get("entryId") ?? "";
  if (!/^[a-f0-9]{8,16}$/.test(entryId)) {
    return NextResponse.json({ error: "这一页不存在" }, { status: 400 });
  }
  return NextResponse.json({ replies: repliesFor(entryId) });
}
