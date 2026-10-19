import { db, type MediaRow } from "./db";
import { getMediaById, publicMedia } from "./media";
import { newId, nowISO } from "./ids";

/** 她留下的痕迹：手账页/信末尾的「已阅」印章，和页面下的评论。
 *  印章每页只有一枚（重复盖返回原来那枚的日期）；评论可以留很多条，
 *  支持文字 + emoji + 图片（图片本体存在 media 表，这里只记 id 数组）。 */

export type MarkRow = {
  id: string;
  entry_id: string;
  kind: "seen" | "reply";
  body: string | null;
  media_ids: string | null;
  created_at: string;
};

/** 评论里引用的一张图（url 走带鉴权的 /api/media） */
export type MarkMedia = {
  id: string;
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
};

export type ReplyItem = {
  body: string;
  createdAt: string;
  media: MarkMedia[];
};

function parseMediaIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string").slice(0, 6);
  } catch {
    return [];
  }
}

/** 评论图的 media 行 -> 展示形状（图片可能已被删，跳过） */
function mediaOfMark(raw: string | null): MarkMedia[] {
  const out: MarkMedia[] = [];
  for (const id of parseMediaIds(raw)) {
    const row = getMediaById(id);
    if (!row || row.kind !== "photo") continue;
    const p = publicMedia(row);
    out.push({ id: row.id, url: p.url, thumbUrl: p.thumbUrl, width: p.width, height: p.height });
  }
  return out;
}

/** 盖章：返回印章日期（ISO）；盖过就返回原来的，不重复盖 */
export function stampSeen(entryId: string): string {
  const existing = db
    .prepare("SELECT created_at FROM marks WHERE entry_id = ? AND kind = 'seen'")
    .get(entryId) as { created_at: string } | undefined;
  if (existing) return existing.created_at;
  const now = nowISO();
  db.prepare("INSERT INTO marks (id, entry_id, kind, body, created_at) VALUES (?, ?, 'seen', NULL, ?)").run(
    newId(),
    entryId,
    now
  );
  return now;
}

export const MAX_REPLY_BODY = 300;
export const MAX_REPLY_IMAGES = 3;

/** 添加评论：文字和图片至少有一样；图片必须是「还没被任何评论认领」的孤儿 photo 行 */
export function addReply(entryId: string, body: string, mediaIds: string[] = []): ReplyItem {
  const clean = body.trim().slice(0, MAX_REPLY_BODY);
  const ids = [...new Set(mediaIds)].slice(0, MAX_REPLY_IMAGES).filter((id) => /^[a-f0-9]{8,16}$/.test(id));
  if (!clean && ids.length === 0) throw new Error("想说点什么再寄嘛，或者配张图");
  // 图片必须是刚为她上传的评论图：photo、没挂条目、也没被别的评论用过
  const claimed = new Set<string>();
  for (const row of db
    .prepare("SELECT media_ids FROM marks WHERE kind = 'reply' AND media_ids IS NOT NULL")
    .all() as { media_ids: string }[]) {
    for (const id of parseMediaIds(row.media_ids)) claimed.add(id);
  }
  const valid = ids.filter((id) => {
    const row = getMediaById(id);
    return row && row.kind === "photo" && row.entry_id === null && !claimed.has(id);
  });
  if (!clean && valid.length === 0) throw new Error("图片好像没传上，重新选一次？");
  const now = nowISO();
  db.prepare(
    "INSERT INTO marks (id, entry_id, kind, body, media_ids, created_at) VALUES (?, ?, 'reply', ?, ?, ?)"
  ).run(newId(), entryId, clean || null, valid.length > 0 ? JSON.stringify(valid) : null, now);
  return { body: clean, createdAt: now, media: mediaOfMark(valid.length > 0 ? JSON.stringify(valid) : null) };
}

/** 一批条目里哪些已经盖过章：entry_id -> 印章日期 */
export function seenMap(entryIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (entryIds.length === 0) return map;
  const marks = db
    .prepare(
      `SELECT entry_id, created_at FROM marks WHERE kind = 'seen'
       AND entry_id IN (${entryIds.map(() => "?").join(",")})`
    )
    .all(...entryIds) as { entry_id: string; created_at: string }[];
  for (const m of marks) map.set(m.entry_id, m.created_at);
  return map;
}

export function repliesFor(entryId: string): ReplyItem[] {
  const rows = db
    .prepare(
      "SELECT body, media_ids, created_at FROM marks WHERE entry_id = ? AND kind = 'reply' ORDER BY created_at ASC"
    )
    .all(entryId) as { body: string | null; media_ids: string | null; created_at: string }[];
  return rows.map((r) => ({ body: r.body ?? "", createdAt: r.created_at, media: mediaOfMark(r.media_ids) }));
}

/** 作者后台看：所有评论（带上条目/场次信息和图片），新的在前。
 *  痕迹可能挂在条目上，也可能挂在放映室的场次上（观后感），两边都取标题 */
export function listReplies(): { id: string; body: string; createdAt: string; media: MarkMedia[]; entryId: string; entryTitle: string | null; entryType: string; entryDate: string }[] {
  return (
    db
      .prepare(
        `SELECT m.id, m.body, m.media_ids, m.created_at AS createdAt, m.entry_id AS entryId,
                COALESCE(e.title, s.title) AS entryTitle,
                CASE WHEN e.id IS NOT NULL THEN e.type ELSE 'screening' END AS entryType,
                COALESCE(e.entry_date, s.premiere_at) AS entryDate
         FROM marks m
         LEFT JOIN entries e ON e.id = m.entry_id
         LEFT JOIN screenings s ON s.id = m.entry_id
         WHERE m.kind = 'reply' ORDER BY m.created_at DESC`
      )
      .all() as {
      id: string;
      body: string | null;
      media_ids: string | null;
      createdAt: string;
      entryId: string;
      entryTitle: string | null;
      entryType: string;
      entryDate: string;
    }[]
  ).map((r) => ({
    id: r.id,
    body: r.body ?? "",
    createdAt: r.createdAt,
    media: mediaOfMark(r.media_ids),
    entryId: r.entryId,
    entryTitle: r.entryTitle,
    entryType: r.entryType,
    entryDate: r.entryDate,
  }));
}

/** 作者后台看：最近盖过的章（带上条目信息），新的在前 */
export function listSeens(limit = 50): { id: string; createdAt: string; entryId: string; entryTitle: string | null; entryType: string; entryDate: string }[] {
  return db
    .prepare(
      `SELECT m.id, m.created_at AS createdAt, m.entry_id AS entryId,
              e.title AS entryTitle, e.type AS entryType, e.entry_date AS entryDate
       FROM marks m LEFT JOIN entries e ON e.id = m.entry_id
       WHERE m.kind = 'seen' ORDER BY m.created_at DESC LIMIT ?`
    )
    .all(limit) as { id: string; createdAt: string; entryId: string; entryTitle: string | null; entryType: string; entryDate: string }[];
}

/** 她的评论里用过的图片（后台媒体清理参考，暂不对外） */
export function replyMediaRows(): MediaRow[] {
  const ids = new Set<string>();
  for (const row of db
    .prepare("SELECT media_ids FROM marks WHERE kind = 'reply' AND media_ids IS NOT NULL")
    .all() as { media_ids: string }[]) {
    for (const id of parseMediaIds(row.media_ids)) ids.add(id);
  }
  return [...ids].map((id) => getMediaById(id)).filter((r): r is MediaRow => Boolean(r));
}
