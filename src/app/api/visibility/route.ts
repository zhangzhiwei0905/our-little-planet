import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAuthor } from "@/lib/auth";
import { nowISO } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^[a-f0-9]{8,16}$/;

/** 批量设置公开/仅她（作者）：「本子里的一切」勾一排历史内容，一次放开或收回 */
export async function POST(req: Request) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as
    | { entryIds?: unknown; milestoneIds?: unknown; visibility?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: "参数不对" }, { status: 400 });
  const visibility = body.visibility === "public" ? "public" : "private";
  const entryIds = Array.isArray(body.entryIds)
    ? [...new Set(body.entryIds.filter((x): x is string => typeof x === "string" && ID_RE.test(x)))]
    : [];
  const milestoneIds = Array.isArray(body.milestoneIds)
    ? [...new Set(body.milestoneIds.filter((x): x is string => typeof x === "string" && ID_RE.test(x)))]
    : [];
  if (entryIds.length === 0 && milestoneIds.length === 0) {
    return NextResponse.json({ error: "先勾选要改的内容" }, { status: 400 });
  }

  const now = nowISO();
  const apply = db.transaction(() => {
    if (entryIds.length > 0) {
      const stmt = db.prepare("UPDATE entries SET visibility = ?, updated_at = ? WHERE id = ?");
      for (const id of entryIds) stmt.run(visibility, now, id);
    }
    if (milestoneIds.length > 0) {
      const stmt = db.prepare("UPDATE milestones SET visibility = ?, updated_at = ? WHERE id = ?");
      for (const id of milestoneIds) stmt.run(visibility, now, id);
    }
  });
  apply();
  return NextResponse.json({
    ok: true,
    visibility,
    entries: entryIds.length,
    milestones: milestoneIds.length,
  });
}
