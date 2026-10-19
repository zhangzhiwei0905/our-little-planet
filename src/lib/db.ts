import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const MEDIA_DIR = path.join(DATA_DIR, "media");
mkdirSync(MEDIA_DIR, { recursive: true });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,             -- journal | photo | quote | letter | board
  title      TEXT,
  body       TEXT NOT NULL DEFAULT '',
  speaker    TEXT,                      -- 语录：谁说的（她说 / 我说）
  mood       TEXT,                      -- 心情贴纸
  entry_date TEXT NOT NULL,             -- YYYY-MM-DD
  published  INTEGER NOT NULL DEFAULT 1,
  reveal_at  TEXT,                      -- 定时可见（YYYY-MM-DD），如定时信
  layout     TEXT,                      -- 自由拼贴页（board）：元素布局 JSON
  ref_media  TEXT,                      -- 引用的相册照片/视频 JSON：[{id,caption,sort}]（条目本体不拥有它们）
  tags       TEXT,                      -- 相册标签 JSON：["青海之行",...]（相册墙按它筛选）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id         TEXT PRIMARY KEY,
  entry_id   TEXT REFERENCES entries(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,             -- photo | video
  mime       TEXT NOT NULL,
  filename   TEXT NOT NULL,             -- local: 文件名；oss: 对象 key
  width      INTEGER,
  height     INTEGER,
  bytes      INTEGER NOT NULL,
  caption    TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  live_video_id TEXT,                   -- Live Photo：配对的视频 media id
  hevc       INTEGER,                   -- 视频是否 HEVC 编码（电脑浏览器大多放不了，用来显示提示）
  duration   REAL,                      -- 音频时长（秒，录音时计时得出；照片视频不用）
  fingerprint TEXT,                     -- 内容指纹（大小-头尾sha256）：识别重复上传
  tags       TEXT,                      -- 相册标签 JSON：["青海之行",...]（每张媒体自己的）
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_entry ON media(entry_id, sort);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(entry_date DESC, created_at DESC);
CREATE TABLE IF NOT EXISTS milestones ( -- 大事记：手动录入的里程碑（第一次 xxx）
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  m_date     TEXT NOT NULL,             -- YYYY-MM-DD
  icon       TEXT,                      -- 贴纸图标（StickerName，可空）
  media_ids  TEXT NOT NULL DEFAULT '[]',-- 关联的照片/视频 media id 数组（JSON，按选择顺序）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milestones_date ON milestones(m_date ASC, created_at ASC);
CREATE TABLE IF NOT EXISTS eggs (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  password    TEXT NOT NULL,
  reveal_date TEXT NOT NULL,             -- 到这天才能解锁
  letter      TEXT NOT NULL DEFAULT '',
  photo_ids   TEXT NOT NULL DEFAULT '[]', -- 精选照片 media id 数组（JSON）
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS egg_doodles ( -- 她在照片上留下的手绘
  id         TEXT PRIMARY KEY,
  egg_id     TEXT NOT NULL,
  photo_id   TEXT NOT NULL,
  strokes    TEXT NOT NULL,              -- JSON: [{color,size,points:[[x,y]...]}] 归一化坐标
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doodles_egg_photo ON egg_doodles(egg_id, photo_id);
CREATE TABLE IF NOT EXISTS tags (      -- 全局标签库：任何地方输入过的标签都在这儿，别处能直接选
  name       TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS marks (     -- 她留下的痕迹：seen=已阅印章（每页一枚） reply=信下的回话
  id         TEXT PRIMARY KEY,
  entry_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,             -- seen | reply
  body       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marks_entry ON marks(entry_id, kind);
CREATE TABLE IF NOT EXISTS guest_visits ( -- 访客记录：未登录的人翻开过哪些页（IP+页面+设备），城市另行解析缓存
  id         TEXT PRIMARY KEY,
  ip         TEXT NOT NULL,
  path       TEXT NOT NULL,
  ua         TEXT,
  bot        INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guest_visits_ip ON guest_visits(ip, created_at);
CREATE INDEX IF NOT EXISTS idx_guest_visits_time ON guest_visits(created_at);
CREATE TABLE IF NOT EXISTS guest_geo (  -- IP → 城市/运营商（查外部接口后缓存，失败隔几天再试）
  ip          TEXT PRIMARY KEY,
  city        TEXT,
  region      TEXT,
  isp         TEXT,
  ok          INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS screenings ( -- 放映室：一段完整的纪念视频一场「首映」，视频本体在 media 表
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,        -- 片名
  subtitle        TEXT,                 -- 导演寄语（一句话）
  media_id        TEXT NOT NULL,        -- 视频的 media id（完整成片，原样播放）
  cover_media_id  TEXT,                 -- 自选封面图的 media id（可空，回落视频抽帧封面）
  premiere_at     TEXT NOT NULL,        -- 首映日期 YYYY-MM-DD：过了这天才能看
  visibility      TEXT NOT NULL DEFAULT 'private',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
`;

declare global {
  var __journalDb: Database.Database | undefined;
}

function getDb(): Database.Database {
  if (!globalThis.__journalDb) {
    const db = new Database(path.join(DATA_DIR, "journal.db"));
    db.pragma("journal_mode = WAL");
    // build 阶段多个 worker 并发建表会撞锁，等一等而不是直接失败
    db.pragma("busy_timeout = 8000");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    // 老库迁移：Live Photo 配对列 / HEVC 标记列 / 自由拼贴页布局列
    try {
      db.exec("ALTER TABLE media ADD COLUMN live_video_id TEXT");
    } catch {
      /* 列已存在 */
    }
    try {
      db.exec("ALTER TABLE media ADD COLUMN hevc INTEGER");
    } catch {
      /* 列已存在 */
    }
    try {
      db.exec("ALTER TABLE entries ADD COLUMN layout TEXT");
    } catch {
      /* 列已存在 */
    }
    try {
      db.exec("ALTER TABLE media ADD COLUMN duration REAL");
    } catch {
      /* 列已存在 */
    }
    // 手账页引用相册已有照片/视频（不搬 entry_id，只是挂个引用）
    try {
      db.exec("ALTER TABLE entries ADD COLUMN ref_media TEXT");
    } catch {
      /* 列已存在 */
    }
    // 内容指纹（大小+头尾哈希）：选文件时用它识别「已经传过」的，避免重复上传
    try {
      db.exec("ALTER TABLE media ADD COLUMN fingerprint TEXT");
    } catch {
      /* 列已存在 */
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_media_fingerprint ON media(fingerprint)");
    // 相册标签（「青海之行」这类，相册墙按它筛选）
    try {
      db.exec("ALTER TABLE entries ADD COLUMN tags TEXT");
    } catch {
      /* 列已存在 */
    }
    // 每张媒体自己的标签（本子里的一切 按张管理）；顺手把老数据从条目级拷下来（只补 NULL 的）
    try {
      db.exec("ALTER TABLE media ADD COLUMN tags TEXT");
    } catch {
      /* 列已存在 */
    }
    // 访客模式：每页内容可单独设公开（public）或仅她登录可见（private，默认）
    try {
      db.exec("ALTER TABLE entries ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'");
    } catch {
      /* 列已存在 */
    }
    // 她的评论可以带图（media id 数组 JSON，图片本体在 media 表）
    try {
      db.exec("ALTER TABLE marks ADD COLUMN media_ids TEXT");
    } catch {
      /* 列已存在 */
    }
    // 访客模式：大事记单条也可设公开/仅她
    try {
      db.exec("ALTER TABLE milestones ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'");
    } catch {
      /* 列已存在 */
    }
    try {
      db.exec(
        `UPDATE media SET tags = (SELECT tags FROM entries WHERE entries.id = media.entry_id)
         WHERE media.tags IS NULL AND media.kind IN ('photo', 'video') AND media.entry_id IS NOT NULL`
      );
    } catch {
      /* 拷不动就算了 */
    }
    // 标签库收口：把散在媒体/条目上的标签收进全局标签库（幂等；删除是全局连内容一起撕，不会被这里复活）
    try {
      const insertTag = db.prepare("INSERT OR IGNORE INTO tags (name, created_at) VALUES (?, ?)");
      const collect = (raw: unknown) => {
        if (typeof raw !== "string") return;
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) for (const t of arr) if (typeof t === "string" && t.trim()) insertTag.run(t.trim().slice(0, 20), new Date().toISOString());
        } catch {
          /* 坏 JSON 跳过 */
        }
      };
      for (const r of db.prepare("SELECT tags FROM media WHERE tags IS NOT NULL").all() as { tags: string }[]) collect(r.tags);
      for (const r of db.prepare("SELECT tags FROM entries WHERE tags IS NOT NULL").all() as { tags: string }[]) collect(r.tags);
    } catch {
      /* 收不进就算了 */
    }
    globalThis.__journalDb = db;
  }
  return globalThis.__journalDb;
}

export const db = getDb();

export type EntryRow = {
  id: string;
  type: "journal" | "photo" | "quote" | "letter" | "board";
  title: string | null;
  body: string;
  speaker: string | null;
  mood: string | null;
  entry_date: string;
  published: number;
  reveal_at: string | null;
  layout: string | null;
  ref_media: string | null;
  tags: string | null;
  /** 访客模式：public = 不登录也能看，private = 仅她（输密码）可见 */
  visibility: "public" | "private";
  created_at: string;
  updated_at: string;
};

export type MediaRow = {
  id: string;
  entry_id: string | null;
  kind: "photo" | "video" | "asset" | "sticker" | "audio"; // asset=拼贴素材（随条目删除） sticker=贴纸库（长期保存复用） audio=语录语音
  mime: string;
  filename: string;
  width: number | null;
  height: number | null;
  bytes: number;
  caption: string | null;
  sort: number;
  live_video_id: string | null;
  hevc: number | null;
  duration: number | null;
  fingerprint: string | null;
  tags: string | null;
  created_at: string;
};
