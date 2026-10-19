import { db } from "./db";
import { newId, nowISO, todayLocal } from "./ids";
import { deleteMediaCompletely, getMediaById, publicMedia, type MediaRow } from "./media";

/** 放映室：每一段完整的纪念视频是一场「首映」。
 *  视频是别处做好的成片，原样上传原样播放；这里只记片名、导演寄语、
 *  首映日期（像定时信，过了那天才能看）和可见性。 */

export type Screening = {
  id: string;
  title: string;
  subtitle: string | null;
  premiereAt: string;
  visibility: "public" | "private";
  createdAt: string;
  updatedAt: string;
  video: {
    id: string;
    url: string;
    posterUrl: string | null;
    hevc: boolean | null;
    duration: number | null;
    /** 画面宽高：竖屏（高>宽）放映时用竖版画幅，不塞 16:9 的框 */
    width: number | null;
    height: number | null;
  };
  coverUrl: string | null;
};

type ScreeningRow = {
  id: string;
  title: string;
  subtitle: string | null;
  media_id: string;
  cover_media_id: string | null;
  premiere_at: string;
  visibility: "public" | "private";
  created_at: string;
  updated_at: string;
};

function rowToScreening(r: ScreeningRow): Screening | null {
  const video = getMediaById(r.media_id);
  if (!video || video.kind !== "video") return null;
  const p = publicMedia(video);
  const cover = r.cover_media_id ? getMediaById(r.cover_media_id) : undefined;
  const coverPub = cover && cover.kind === "photo" ? publicMedia(cover) : null;
  return {
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    premiereAt: r.premiere_at,
    visibility: r.visibility === "public" ? "public" : "private",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    video: { id: video.id, url: p.url, posterUrl: p.posterUrl, hevc: video.hevc === 1 ? true : null, duration: video.duration, width: video.width, height: video.height },
    coverUrl: coverPub ? coverPub.thumbUrl ?? coverPub.url : null,
  };
}

/** 首映日期到了没有（当天就算开演） */
export function premiered(s: { premiereAt: string }): boolean {
  return s.premiereAt <= todayLocal();
}

/** 距首映还有几天（当天 = 0；已首映返回 0） */
export function daysUntilPremiere(s: { premiereAt: string }): number {
  const today = todayLocal();
  if (s.premiereAt <= today) return 0;
  return Math.round((new Date(`${s.premiereAt}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
}

/** 场次列表：新的在前。
 *  includeUnpublished = 作者预览未首映的场次；guest = 只看公开场次 */
export function listScreenings(opts: { includeUnpublished?: boolean; guest?: boolean } = {}): Screening[] {
  const rows = db
    .prepare(
      `SELECT * FROM screenings ${opts.guest ? "WHERE visibility = 'public'" : ""}
       ORDER BY premiere_at DESC, created_at DESC`
    )
    .all() as ScreeningRow[];
  const out: Screening[] = [];
  for (const r of rows) {
    const s = rowToScreening(r);
    if (!s) continue;
    if (!opts.includeUnpublished && !premiered(s)) continue;
    out.push(s);
  }
  return out;
}

export function getScreening(id: string): Screening | undefined {
  const row = db.prepare("SELECT * FROM screenings WHERE id = ?").get(id) as ScreeningRow | undefined;
  return row ? rowToScreening(row) ?? undefined : undefined;
}

export type ScreeningInput = {
  title: string;
  subtitle?: string;
  premiereAt: string;
  mediaId: string;
  coverMediaId?: string | null;
  visibility?: "public" | "private";
};

/** 校验媒体可用：视频/封面既可以是刚上传的孤儿（放映室专用，不进相册），
 *  也可以直接引用本子里已有的（引用不挪动原位，原处照常展示） */
function claimMedia(id: string, kind: "video" | "photo"): boolean {
  const row: MediaRow | undefined = getMediaById(id);
  return Boolean(row && row.kind === kind);
}

/** 这个媒体还有没有别的场次在用（删场次/换片时判断能不能连文件删掉） */
function refCountOf(mediaId: string, excludeScreeningId?: string): number {
  const n = db
    .prepare("SELECT COUNT(*) AS n FROM screenings WHERE (media_id = ? OR cover_media_id = ?) AND id != ?")
    .get(mediaId, mediaId, excludeScreeningId ?? "") as { n: number };
  return n.n;
}

/** 删掉一场放映的媒体文件：只有「孤儿且没有别的场次引用」才连文件删；
 *  从本子里选来的（挂在条目上）原样留在相册/手账里 */
async function deleteScreeningMedia(mediaId: string | null, excludeScreeningId?: string): Promise<void> {
  if (!mediaId) return;
  if (refCountOf(mediaId, excludeScreeningId) > 0) return;
  const m = getMediaById(mediaId);
  if (!m || m.entry_id !== null) return;
  await deleteMediaCompletely(m).catch(() => undefined);
}

export function createScreening(input: ScreeningInput): Screening {
  const title = input.title.trim();
  if (!title || title.length > 60) throw new Error("片名必填，60 字以内");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.premiereAt)) throw new Error("首映日期格式不对");
  if (!/^[a-f0-9]{8,16}$/.test(input.mediaId) || !claimMedia(input.mediaId, "video")) {
    throw new Error("视频还没传好，或已经被别的内容占用了");
  }
  if (input.coverMediaId && !claimMedia(input.coverMediaId, "photo")) input.coverMediaId = null;
  const now = nowISO();
  const id = newId();
  db.prepare(
    `INSERT INTO screenings (id, title, subtitle, media_id, cover_media_id, premiere_at, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title,
    input.subtitle?.trim().slice(0, 120) || null,
    input.mediaId,
    input.coverMediaId ?? null,
    input.premiereAt,
    input.visibility === "public" ? "public" : "private",
    now,
    now
  );
  const s = getScreening(id);
  if (!s) throw new Error("场次没建上，再试一次？");
  return s;
}

export async function updateScreening(id: string, input: ScreeningInput): Promise<Screening> {
  const title = input.title.trim();
  if (!title || title.length > 60) throw new Error("片名必填，60 字以内");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.premiereAt)) throw new Error("首映日期格式不对");
  const old = db.prepare("SELECT * FROM screenings WHERE id = ?").get(id) as ScreeningRow | undefined;
  if (!old) throw new Error("这场放映不存在");
  let mediaId = old.media_id;
  if (input.mediaId && input.mediaId !== old.media_id) {
    if (!/^[a-f0-9]{8,16}$/.test(input.mediaId) || !claimMedia(input.mediaId, "video")) {
      throw new Error("视频还没传好，或已经被别的内容占用了");
    }
    mediaId = input.mediaId;
  }
  let coverMediaId = old.cover_media_id;
  if (input.coverMediaId !== undefined) {
    coverMediaId = input.coverMediaId && claimMedia(input.coverMediaId, "photo") ? input.coverMediaId : null;
  }
  db.prepare(
    `UPDATE screenings SET title = ?, subtitle = ?, media_id = ?, cover_media_id = ?, premiere_at = ?, visibility = ?, updated_at = ? WHERE id = ?`
  ).run(
    title,
    input.subtitle?.trim().slice(0, 120) || null,
    mediaId,
    coverMediaId,
    input.premiereAt,
    input.visibility === "public" ? "public" : input.visibility === "private" ? "private" : old.visibility,
    nowISO(),
    id
  );
  // 换了视频：旧视频如果是放映室专属的孤儿文件，删掉；从本子里选来的不动
  if (mediaId !== old.media_id) {
    await deleteScreeningMedia(old.media_id, id);
  }
  const s = getScreening(id);
  if (!s) throw new Error("这场放映不存在");
  return s;
}

/** 只改可见性（列表快捷开关用） */
export function setScreeningVisibility(id: string, visibility: "public" | "private"): void {
  db.prepare("UPDATE screenings SET visibility = ?, updated_at = ? WHERE id = ?").run(visibility, nowISO(), id);
}

/** 删掉一场放映：放映室专属的孤儿文件（视频/封面）连文件一起删；
 *  从本子里选来的媒体留在原处 */
export async function deleteScreening(id: string): Promise<void> {
  const row = db.prepare("SELECT * FROM screenings WHERE id = ?").get(id) as ScreeningRow | undefined;
  if (!row) return;
  db.prepare("DELETE FROM screenings WHERE id = ?").run(id);
  await deleteScreeningMedia(row.media_id, id);
  await deleteScreeningMedia(row.cover_media_id, id);
}
