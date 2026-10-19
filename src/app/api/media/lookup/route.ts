import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAuthor } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 查指纹有没有传过（作者）：选文件时识别重复，灰掉不再传一遍。
 *  返回 { found: { 指纹: { id, kind, thumbUrl, entryDate, caption } } }，没传过的不在结果里 */
export async function POST(req: Request) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { fps?: unknown } | null;
  const fps = Array.isArray(body?.fps)
    ? body.fps.filter((f): f is string => typeof f === "string" && /^\d{1,13}-[a-f0-9]{64}$/.test(f)).slice(0, 500)
    : [];
  if (fps.length === 0) return NextResponse.json({ found: {} });
  const rows = db
    .prepare(
      `SELECT m.fingerprint AS fp, m.id, m.kind, m.caption, e.entry_date AS entryDate
       FROM media m LEFT JOIN entries e ON m.entry_id = e.id
       WHERE m.fingerprint IN (${fps.map((_, i) => `@f${i}`).join(", ")})`
    )
    .all(Object.fromEntries(fps.map((f, i) => [`f${i}`, f]))) as {
    fp: string;
    id: string;
    kind: "photo" | "video";
    caption: string | null;
    entryDate: string | null;
  }[];
  const found: Record<string, { id: string; kind: "photo" | "video"; thumbUrl: string | null; entryDate: string | null; caption: string | null }> = {};
  for (const r of rows) {
    found[r.fp] ??= {
      id: r.id,
      kind: r.kind === "video" ? "video" : "photo",
      thumbUrl: r.kind === "photo" ? `/api/media/${r.id}?thumb=1` : null,
      entryDate: r.entryDate,
      caption: r.caption,
    };
  }
  return NextResponse.json({ found });
}
