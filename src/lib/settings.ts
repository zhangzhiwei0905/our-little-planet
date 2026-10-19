import { db } from "./db";

export type SiteSettings = {
  /** 本子的名字，如「我们的小星球」 */
  title: string;
  /** 封面上的两个人，如「小张 ♥ 小星」 */
  names: string;
  /** 在一起的纪念日 YYYY-MM-DD，首页天数从这天算起 */
  startDate: string;
  /** Someday 彩蛋：揭晓日期 YYYY-MM-DD，空 = 未配置 */
  somedayDate: string;
  /** Someday 彩蛋：揭晓那天的标题 */
  somedayTitle: string;
  /** Someday 彩蛋：单独密码（不同于解锁本子的密码） */
  somedayPassword: string;
  /** Someday 彩蛋：揭晓时展示的长信 */
  somedayLetter: string;
  /** 语录便利贴上隐藏日期（"1" = 隐藏）：整批导入的语录都是同一天，墙上一排同日期不好看 */
  quotesHideDate: string;
  /** 大事记背景音乐：音频 media id（空 = 未配置，时间轴不渲染播放器） */
  bgmMediaId: string;
  /** 大事记背景音乐：显示名（如「我们的歌 - 某位歌手」） */
  bgmTitle: string;
  /** 大事记背景音乐：LRC 歌词原文（带时间标签则逐行跟唱，纯文本则当信纸读） */
  bgmLyrics: string;
  /** 访客模式：各栏目对不登录的访客是否公开（"1" = 公开）。默认全关，只有她登录才能看 */
  guestHome: string;
  guestJournal: string;
  guestAlbum: string;
  guestQuotes: string;
  guestLetters: string;
  guestTimeline: string;
  guestScreenings: string;
  /** 访客模式：访客进门时看到的一句话（可不填） */
  guestWelcome: string;
};

export const DEFAULT_SETTINGS: SiteSettings = {
  title: "我们的小星球",
  names: "小张 ♥ 小星",
  startDate: "2025-05-20",
  somedayDate: "",
  somedayTitle: "",
  somedayPassword: "",
  somedayLetter: "",
  quotesHideDate: "0",
  bgmMediaId: "",
  bgmTitle: "",
  bgmLyrics: "",
  guestHome: "0",
  guestJournal: "0",
  guestAlbum: "0",
  guestQuotes: "0",
  guestLetters: "0",
  guestTimeline: "0",
  guestScreenings: "0",
  guestWelcome: "",
};

const KEYS = [
  "title",
  "names",
  "startDate",
  "somedayDate",
  "somedayTitle",
  "somedayPassword",
  "somedayLetter",
  "quotesHideDate",
  "bgmMediaId",
  "bgmTitle",
  "bgmLyrics",
  "guestHome",
  "guestJournal",
  "guestAlbum",
  "guestQuotes",
  "guestLetters",
  "guestTimeline",
  "guestScreenings",
  "guestWelcome",
] as const;

export function getSettings(): SiteSettings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULT_SETTINGS };
  for (const k of KEYS) {
    if (map[k] !== undefined) (out as Record<string, string>)[k] = map[k];
  }
  return out;
}

export function saveSettings(patch: Partial<SiteSettings>): SiteSettings {
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const run = db.transaction((p: Partial<SiteSettings>) => {
    for (const [key, value] of Object.entries(p)) {
      // 允许存空串（比如清掉 someday 配置），只挡 undefined/null
      if (value !== undefined && value !== null) {
        stmt.run(key, String(value).trim());
      }
    }
  });
  run(patch);
  return getSettings();
}

/** 顶部导航的栏目 key（顺序即导航顺序） */
export const SECTIONS = ["home", "journal", "album", "quotes", "letters", "timeline", "screenings"] as const;
export type SectionKey = (typeof SECTIONS)[number];

const SECTION_SETTING: Record<SectionKey, keyof SiteSettings> = {
  home: "guestHome",
  journal: "guestJournal",
  album: "guestAlbum",
  quotes: "guestQuotes",
  letters: "guestLetters",
  timeline: "guestTimeline",
  screenings: "guestScreenings",
};

/** 每个栏目对访客（未登录）是否公开 */
export function sectionVisibility(settings: SiteSettings): Record<SectionKey, boolean> {
  const out = {} as Record<SectionKey, boolean>;
  for (const s of SECTIONS) out[s] = settings[SECTION_SETTING[s]] === "1";
  return out;
}

/** 某个栏目访客能不能看（没配置过的旧库默认全部仅登录） */
export function sectionOpen(settings: SiteSettings, section: SectionKey): boolean {
  return settings[SECTION_SETTING[section]] === "1";
}
