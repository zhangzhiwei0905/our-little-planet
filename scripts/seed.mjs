// 填一本示例手账：npm run seed
// 照片优先从 picsum.photos 下载示例图；断网时生成温柔的渐变占位图，保证本子不空
import Database from "better-sqlite3";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const MEDIA_DIR = path.join(DATA_DIR, "media");

// 与 src/lib/db.ts 的 schema 保持一致
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, body TEXT NOT NULL DEFAULT '',
  speaker TEXT, mood TEXT, entry_date TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 1,
  reveal_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY, entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, mime TEXT NOT NULL, filename TEXT NOT NULL,
  width INTEGER, height INTEGER, bytes INTEGER NOT NULL, caption TEXT,
  sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_entry ON media(entry_id, sort);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(entry_date DESC, created_at DESC);
`;

const id = () => randomBytes(8).toString("hex").slice(0, 12);

async function fetchPhoto(seed, w, h) {
  try {
    const res = await fetch(`https://picsum.photos/seed/${seed}/${w}/${h}`, {
      signal: AbortSignal.timeout(12000),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(String(res.status));
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, mime: "image/jpeg", ext: ".jpg", w, h };
  } catch {
    // 离线占位：柔和渐变 + 一颗爱心
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f9dfe8"/><stop offset="1" stop-color="#f7e3a1"/>
  </linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <path d="M${w / 2} ${h * 0.56}C${w * 0.36} ${h * 0.45} ${w * 0.42} ${h * 0.32} ${w / 2} ${h * 0.4}C${w * 0.58} ${h * 0.32} ${w * 0.64} ${h * 0.45} ${w / 2} ${h * 0.56}z" fill="#e48ba8"/>
  <text x="50%" y="${h * 0.72}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(w * 0.045)}" fill="#b4506b">our photo · ${seed}</text>
</svg>`;
    const buf = Buffer.from(svg);
    return { buf, mime: "image/svg+xml", ext: ".svg", w, h };
  }
}

// ---------- 示例内容（记得全部换成你们自己的） ----------

const today = new Date().toLocaleDateString("en-CA");

const SETTINGS = {
  title: "我们的小星球",
  names: "小张 ♥ 小星",
  startDate: "2025-05-20",
  // Someday 彩蛋示例：日期设为今天，现在就能体验完整流程（生产环境请改成真正的惊喜日）
  somedayDate: today,
  somedayTitle: "给你的礼物",
  somedayPassword: "iloveu",
  somedayLetter:
    "展信安。\n\n如果你正在看这一页，说明两件事：那一天到了，而且你猜对了，我确实还藏了一个秘密。\n\n这本手账里的每一页，都是我偷偷记下来的。你以为我只是随手拍拍照，其实我在攒一件很大的礼物，攒到今天才敢给你。\n\n从奶茶店门口那天算起，我们一起看了海、追了烟花、去了青海湖，你的每一个生日我都假装忘记，其实提前半个月就开始准备。\n\n**谢谢你在人海里挑中了我。**\n\n往后的日子，这一页不再只有我一个人写了。",
};

const CONTENT = [
  {
    type: "journal",
    date: "2025-05-20",
    title: "在一起的第一天",
    mood: "heart",
    body:
      "今天把憋了很久的话说出了口。\n\n你在奶茶店门口愣了三秒，然后笑着捶了我一下，说「你怎么现在才说」。\n\n从今天起，我要把我们所有的日子都记在这里。等哪一天给你看，吓你一跳。",
    photos: [
      { seed: "planet-first-milk-tea", w: 1200, h: 1500, caption: "May 20 · 第一杯奶茶" },
      { seed: "planet-first-street", w: 1400, h: 1000, caption: "那天傍晚的街" },
    ],
  },
  {
    type: "journal",
    date: "2025-06-14",
    title: "海边的日落",
    mood: "cloud",
    body:
      "你说海风把头发吹乱了，我觉得很好看。\n\n回来的车上你靠着我的肩膀睡着了，我一动不敢动，肩膀酸了也认了。",
    photos: [
      { seed: "planet-sea-sunset", w: 1500, h: 1000, caption: "June 14 · 日落" },
      { seed: "planet-sea-feet", w: 1200, h: 1200, caption: "两双鞋和一片海" },
    ],
  },
  {
    type: "quote",
    date: "2025-08-02",
    speaker: "她说",
    body: "「以后我们家的猫，必须叫煤球，不接受反驳。」",
  },
  {
    type: "journal",
    date: "2025-08-02",
    title: "游乐园一整天",
    mood: "star",
    body:
      "过山车你叫得比谁都大声，下来却说「也就那样」。\n\n棉花糖是我排队买的，你咬了一大口还嫌甜。晚上烟花开的时候，你眼睛比烟花亮。",
    photos: [
      { seed: "planet-park-ferris", w: 1200, h: 1500, caption: "Aug 2 · 摩天轮" },
      { seed: "planet-park-candy", w: 1200, h: 1200, caption: "棉花糖（被咬之前）" },
      { seed: "planet-park-night", w: 1500, h: 1000, caption: "烟花和你的眼睛" },
    ],
  },
  {
    type: "quote",
    date: "2025-10-19",
    speaker: "我说",
    body: "「有你在的雨天，好像也没那么讨厌。」她说完自己也愣了一下。",
  },
  {
    type: "photo",
    date: "2025-12-31",
    body: "跨年夜，江边的人好多，我们挤在人群里倒计时。",
    photos: [
      { seed: "planet-nye-fireworks", w: 1500, h: 1000, caption: "Dec 31 · 十、九、八…" },
      { seed: "planet-nye-river", w: 1400, h: 1400, caption: "零点后的江边" },
    ],
  },
  {
    type: "journal",
    date: "2026-02-14",
    title: "第一个情人节",
    mood: "heart",
    body:
      "提前两周订的花，还是差点被抢空。\n\n你嘴上说「买花干嘛，不如吃顿好的」，拍照的时候倒是很积极。",
    photos: [
      { seed: "planet-valentine-flowers", w: 1200, h: 1500, caption: "Feb 14 · 花和你" },
    ],
  },
  {
    type: "journal",
    date: "2026-05-20",
    title: "一周年",
    mood: "flower",
    body:
      "整整一年，365 天，一天都没舍得少记。\n\n今年的蛋糕还是你选的芋泥味。吹蜡烛的时候你说「愿望不告诉你」，\n\n**其实我猜到了，因为我的愿望和你的一样。**",
    photos: [
      { seed: "planet-anniv-cake", w: 1200, h: 1200, caption: "May 20 · 芋泥蛋糕" },
      { seed: "planet-anniv-hands", w: 1400, h: 1000, caption: "第二年也请多指教" },
      { seed: "planet-anniv-dinner", w: 1400, h: 1400, caption: "周年晚餐" },
    ],
  },
  {
    type: "quote",
    date: "2026-07-12",
    speaker: "她说",
    body: "「你拍我的时候能不能提醒我收下巴！」",
  },
  {
    type: "journal",
    date: "2026-07-12",
    title: "青海湖七日",
    mood: "cloud",
    body:
      "七天的旅行，第一天就吵了一架（导航的锅），后面六天好得像蜜月。\n\n湖边风大得帽子都飞了，你追帽子的时候我按下了快门。\n\n**这是我今年拍得最好的一张照片。**",
    photos: [
      { seed: "planet-qinghai-lake", w: 1500, h: 1000, caption: "Jul 12 · 青海湖" },
      { seed: "planet-qinghai-hat", w: 1200, h: 1500, caption: "追帽子的人" },
      { seed: "planet-qinghai-road", w: 1500, h: 1000, caption: "公路和云" },
      { seed: "planet-qinghai-camp", w: 1400, h: 1400, caption: "露营的晚上" },
    ],
  },
  {
    type: "journal",
    date: "2026-09-12",
    title: "你的生日",
    mood: "coffee",
    body:
      "假装忘了你的生日，其实礼物在衣柜最上层藏了半个月。\n\n你拆礼物的时候哭了，又笑着说「谁哭了我没有」。\n\n生日快乐，我的小行星。",
    photos: [
      { seed: "planet-birthday-gift", w: 1200, h: 1500, caption: "Sep 12 · 拆礼物" },
      { seed: "planet-birthday-cake", w: 1400, h: 1400, caption: "吹蜡烛许愿" },
    ],
  },
  {
    type: "letter",
    date: "2025-12-24",
    title: "平安夜的信",
    body:
      "展信安。\n\n这是这本手账里的第一封信，趁你睡着偷偷写。\n\n今年最幸运的事，是五月那个普通的下午，你答应了我。后来的每一天，好天气坏天气，都因为你变成好日子。\n\n你总说自己爱忘事，那正好，**忘了的我都替你记在这本手账里**，等老了念给你听。\n\n平安夜快乐，做个有我的梦。",
  },
  {
    type: "letter",
    date: "2026-09-15",
    revealAt: "2026-12-31",
    title: "写给 2026 年末的你",
    body:
      "展信安。\n\n写这封信的时候，你还不知道它的存在。\n\n它会在 2026 年的最后一晚被拆开。到时候回头看，这一年我们一起去了青海湖，过了第一个情人节和一周年，你的生日我又骗你说忘了。\n\n如果拆这封信的时候我们正靠在一起跨年，那就对了，我的计划成功了。\n\n新年快乐，明年也请多指教。",
  },
];

// ---------- 写入 ----------

rmSync(MEDIA_DIR, { recursive: true, force: true });
mkdirSync(MEDIA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "journal.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA);
db.exec("DELETE FROM settings; DELETE FROM entries; DELETE FROM media;");

const setStmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
for (const [k, v] of Object.entries(SETTINGS)) setStmt.run(k, v);

const insertEntry = db.prepare(
  `INSERT INTO entries (id, type, title, body, speaker, mood, entry_date, published, reveal_at, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
);
const insertMedia = db.prepare(
  `INSERT INTO media (id, entry_id, kind, mime, filename, width, height, bytes, caption, sort, created_at)
   VALUES (?, ?, 'photo', ?, ?, ?, ?, ?, ?, ?, ?)`
);

let photoCount = 0;
for (const item of CONTENT) {
  const now = new Date().toISOString();
  const entryId = id();
  insertEntry.run(
    entryId,
    item.type,
    item.title ?? null,
    item.body ?? "",
    item.speaker ?? null,
    item.mood ?? null,
    item.date,
    item.revealAt ?? null,
    now,
    now
  );
  let sort = 0;
  for (const p of item.photos ?? []) {
    const { buf, mime, ext, w, h } = await fetchPhoto(p.seed, p.w, p.h);
    const mediaId = id();
    const filename = `${mediaId}${ext}`;
    writeFileSync(path.join(MEDIA_DIR, filename), buf);
    insertMedia.run(mediaId, entryId, mime, filename, w, h, buf.byteLength, p.caption ?? null, sort++, now);
    photoCount++;
  }
  console.log(`✓ ${item.date} · ${item.title ?? item.speaker ?? item.type}`);
}

console.log(`\n种好了：${CONTENT.length} 页手账，${photoCount} 张照片。`);
console.log("解锁密码默认 0520，作者口令默认 write-for-her（在 .env.local 里改）。");
db.close();
