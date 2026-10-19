import { db, type MediaRow } from "./db";
import { newId, nowISO } from "./ids";
import { getMediaById, publicMedia } from "./media";
import type { PublicMedia } from "./entries";
import { isStickerName, type StickerName } from "@/components/journal/Sticker";

/** 大事记（里程碑）：手动录入的「第一次 xxx」，关联相册里的照片/视频。
 *  时间轴不再自动铺全部条目——那又慢又杂，这里只放你挑出来的时刻。 */

export type MilestoneRow = {
  id: string;
  title: string;
  body: string;
  m_date: string;
  icon: string | null;
  media_ids: string;
  /** 访客模式：public = 不登录也能看 */
  visibility: "public" | "private";
  created_at: string;
  updated_at: string;
};

export type Milestone = {
  id: string;
  title: string;
  body: string;
  date: string;
  icon: StickerName | null;
  media: PublicMedia[];
  visibility: "public" | "private";
  createdAt: string;
  updatedAt: string;
};

export type MilestoneInput = {
  title?: string;
  body?: string;
  date?: string;
  icon?: string | null;
  mediaIds?: string[];
  /** 访客模式：public = 不登录也能看；缺省 = 不改动（新建时默认 private） */
  visibility?: "public" | "private";
};

function rowToMilestone(r: MilestoneRow): Milestone {
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(r.media_ids);
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    /* 坏 JSON 当空处理 */
  }
  const media = ids
    .map((id) => getMediaById(id))
    .filter((m): m is MediaRow => Boolean(m))
    // 时间轴已经通过读者锁，OSS 模式直接下发短时签名地址，省掉每张图一次应用层检查和跳转。
    .map((m) => publicMedia(m, { direct: true }));
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    date: r.m_date,
    icon: r.icon && isStickerName(r.icon) ? r.icon : null,
    media,
    visibility: r.visibility === "public" ? "public" : "private",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listMilestones(opts: { guest?: boolean } = {}): Milestone[] {
  const rows = (
    opts.guest
      ? db.prepare("SELECT * FROM milestones WHERE visibility = 'public' ORDER BY m_date ASC, created_at ASC")
      : db.prepare("SELECT * FROM milestones ORDER BY m_date ASC, created_at ASC")
  ).all() as MilestoneRow[];
  return rows.map(rowToMilestone);
}

function sanitizeInput(input: MilestoneInput) {
  const title = (input.title ?? "").trim();
  if (!title || title.length > 60) throw new Error("标题必填，60 字以内");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) throw new Error("日期格式不对");
  const icon = input.icon && isStickerName(input.icon) ? input.icon : null;
  const mediaIds = [...new Set(input.mediaIds ?? [])].filter((id) => /^[a-f0-9]{8,16}$/.test(id)).slice(0, 30);
  return { title, body: (input.body ?? "").slice(0, 2000), date: input.date!, icon, mediaIds };
}

export function createMilestone(input: MilestoneInput): Milestone {
  const clean = sanitizeInput(input);
  const now = nowISO();
  const id = newId();
  db.prepare(
    `INSERT INTO milestones (id, title, body, m_date, icon, media_ids, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, clean.title, clean.body, clean.date, clean.icon, JSON.stringify(clean.mediaIds), input.visibility === "public" ? "public" : "private", now, now);
  const row = db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as MilestoneRow;
  return rowToMilestone(row);
}

export function updateMilestone(id: string, input: MilestoneInput): Milestone {
  const clean = sanitizeInput(input);
  // 没传可见性就保留原值（列表快捷开关之外的地方不用关心这个字段）
  db.prepare("UPDATE milestones SET title = ?, body = ?, m_date = ?, icon = ?, media_ids = ?, visibility = ?, updated_at = ? WHERE id = ?").run(
    clean.title,
    clean.body,
    clean.date,
    clean.icon,
    JSON.stringify(clean.mediaIds),
    input.visibility ?? getMilestoneVisibility(id),
    nowISO(),
    id
  );
  const row = db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as MilestoneRow | undefined;
  if (!row) throw new Error("这条大事记不存在");
  return rowToMilestone(row);
}

function getMilestoneVisibility(id: string): "public" | "private" {
  return (
    db.prepare("SELECT visibility FROM milestones WHERE id = ?").get(id) as { visibility: "public" | "private" } | undefined
  )?.visibility ?? "private";
}

/** 只改单条可见性（后台列表快捷开关用） */
export function setMilestoneVisibility(id: string, visibility: "public" | "private"): void {
  db.prepare("UPDATE milestones SET visibility = ?, updated_at = ? WHERE id = ?").run(visibility, nowISO(), id);
}

export function deleteMilestone(id: string): void {
  // 只删记录本身，照片/视频留在相册里
  db.prepare("DELETE FROM milestones WHERE id = ?").run(id);
}
