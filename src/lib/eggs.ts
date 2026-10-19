import { db, type MediaRow } from "./db";
import { newId, nowISO, todayLocal } from "./ids";
import { publicMedia, getMediaById } from "./media";

export type Egg = {
  id: string;
  title: string;
  password: string;
  revealDate: string;
  letter: string;
  photoIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type EggPhoto = ReturnType<typeof publicMedia>;

export type EggDoodle = {
  id: string;
  photoId: string;
  strokes: { color: string; size: number; points: number[][] }[];
  createdAt: string;
};

type EggRow = {
  id: string;
  title: string;
  password: string;
  reveal_date: string;
  letter: string;
  photo_ids: string;
  created_at: string;
  updated_at: string;
};

function rowToEgg(r: EggRow): Egg {
  let ids: string[] = [];
  try {
    ids = JSON.parse(r.photo_ids) as string[];
  } catch {
    ids = [];
  }
  return {
    id: r.id,
    title: r.title,
    password: r.password,
    revealDate: r.reveal_date,
    letter: r.letter,
    photoIds: ids,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listEggs(): Egg[] {
  return (db.prepare("SELECT * FROM eggs ORDER BY reveal_date ASC, created_at ASC").all() as EggRow[]).map(rowToEgg);
}

/** 读者视角：只暴露已到期的彩蛋，且不含密码与信件内容 */
export function listArrivedEggs(): { id: string; title: string; revealDate: string; photoCount: number }[] {
  return listEggs()
    .filter((e) => todayLocal() >= e.revealDate)
    .map((e) => ({ id: e.id, title: e.title, revealDate: e.revealDate, photoCount: e.photoIds.length }));
}

export function getEgg(id: string): Egg | undefined {
  const row = db.prepare("SELECT * FROM eggs WHERE id = ?").get(id) as EggRow | undefined;
  return row ? rowToEgg(row) : undefined;
}

export type EggInput = {
  title: string;
  password: string;
  revealDate: string;
  letter: string;
  photoIds: string[];
};

export function createEgg(input: EggInput): Egg {
  if (!input.title.trim()) throw new Error("彩蛋还差个标题");
  if (!input.password.trim()) throw new Error("给这个彩蛋设一串只有她知道的密码");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.revealDate)) throw new Error("揭晓日期格式不对");
  const now = nowISO();
  const egg: Egg = {
    id: newId(),
    title: input.title.trim(),
    password: input.password.trim(),
    revealDate: input.revealDate,
    letter: input.letter ?? "",
    photoIds: [...new Set(input.photoIds)],
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO eggs (id, title, password, reveal_date, letter, photo_ids, created_at, updated_at)
     VALUES (@id, @title, @password, @revealDate, @letter, @photoIds, @createdAt, @updatedAt)`
  ).run({ ...egg, photoIds: JSON.stringify(egg.photoIds) });
  return egg;
}

export function updateEgg(id: string, input: EggInput): Egg {
  const existing = getEgg(id);
  if (!existing) throw new Error("这个彩蛋不存在");
  if (!input.title.trim()) throw new Error("彩蛋还差个标题");
  if (!input.password.trim()) throw new Error("给这个彩蛋设一串只有她知道的密码");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.revealDate)) throw new Error("揭晓日期格式不对");
  db.prepare(
    `UPDATE eggs SET title = ?, password = ?, reveal_date = ?, letter = ?, photo_ids = ?, updated_at = ? WHERE id = ?`
  ).run(
    input.title.trim(),
    input.password.trim(),
    input.revealDate,
    input.letter ?? "",
    JSON.stringify([...new Set(input.photoIds)]),
    nowISO(),
    id
  );
  return getEgg(id)!;
}

export function deleteEgg(id: string): void {
  db.prepare("DELETE FROM egg_doodles WHERE egg_id = ?").run(id);
  db.prepare("DELETE FROM eggs WHERE id = ?").run(id);
}

/** 彩蛋里精选的照片/视频（按选定顺序，跳过已不存在的） */
export function eggPhotos(egg: Egg): EggPhoto[] {
  return egg.photoIds
    .map((pid) => getMediaById(pid))
    .filter((m): m is MediaRow => Boolean(m) && (m!.kind === "photo" || m!.kind === "video"))
    .map((m) => publicMedia(m));
}

// ---------- 旧版 someday 迁移 ----------

import { getSettings, saveSettings } from "./settings";

/** 旧版 settings 里的单一 Someday 配置 → 转成第一条彩蛋（幂等：已有彩蛋则只清残留配置） */
export function migrateLegacySomeday(): void {
  const s = getSettings() as unknown as Record<string, string>;
  const date = s.somedayDate ?? "";
  const pw = s.somedayPassword ?? "";
  const letter = s.somedayLetter ?? "";
  const title = s.somedayTitle ?? "";
  if (!date && !pw) return;
  const count = (db.prepare("SELECT COUNT(*) AS n FROM eggs").get() as { n: number }).n;
  if (count === 0 && date && pw) {
    createEgg({ title: title || "给你的礼物", password: pw, revealDate: date, letter, photoIds: [] });
  }
  saveSettings({ somedayDate: "", somedayTitle: "", somedayPassword: "", somedayLetter: "" } as never);
}

// ---------- 涂鸦 ----------

export function listDoodles(eggId: string, photoId?: string): EggDoodle[] {
  const rows = photoId
    ? db.prepare("SELECT * FROM egg_doodles WHERE egg_id = ? AND photo_id = ? ORDER BY created_at").all(eggId, photoId)
    : db.prepare("SELECT * FROM egg_doodles WHERE egg_id = ? ORDER BY created_at").all(eggId);
  return (rows as { id: string; photo_id: string; strokes: string; created_at: string }[]).map((r) => ({
    id: r.id,
    photoId: r.photo_id,
    strokes: JSON.parse(r.strokes) as EggDoodle["strokes"],
    createdAt: r.created_at,
  }));
}

export function saveDoodle(eggId: string, photoId: string, strokes: EggDoodle["strokes"]): EggDoodle {
  if (!Array.isArray(strokes) || strokes.length === 0) throw new Error("还没有画下什么");
  const doodle: EggDoodle = { id: newId(), photoId, strokes, createdAt: nowISO() };
  db.prepare("INSERT INTO egg_doodles (id, egg_id, photo_id, strokes, created_at) VALUES (?, ?, ?, ?, ?)").run(
    doodle.id,
    eggId,
    photoId,
    JSON.stringify(strokes),
    doodle.createdAt
  );
  return doodle;
}

/** 每个彩蛋的照片留言数（作者后台角标用） */
export function doodleCounts(eggId: string): Map<string, number> {
  const rows = db
    .prepare("SELECT photo_id, COUNT(*) AS n FROM egg_doodles WHERE egg_id = ? GROUP BY photo_id")
    .all(eggId) as { photo_id: string; n: number }[];
  return new Map(rows.map((r) => [r.photo_id, r.n]));
}
