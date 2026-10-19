// 把大事记（milestones）逐条转成手账页（entries.type='journal'）：
//   标题/正文/日期原样搬过去，心情贴纸 = 大事记图标，
//   照片视频用 ref_media「引用」（相册里的原文件不动，删手账页也不会删掉它们）。
// 大事记本身一条不删——以后要在时间轴上填更重要的内容，这里只是复制。
// 幂等：同一天 + 同标题的手账页已存在就跳过，可重复运行。
//
// 用法（在应用根目录，node 22+）：
//   node scripts/milestones-to-journal.mjs            # 实际写入
//   node scripts/milestones-to-journal.mjs --dry-run  # 只打印会做什么，不写库
import Database from "better-sqlite3";
import path from "node:path";
import { randomBytes } from "node:crypto";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, "data", "journal.db");
const DRY_RUN = process.argv.includes("--dry-run");

const newId = () => randomBytes(8).toString("hex").slice(0, 12);
const nowISO = () => new Date().toISOString();

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const milestones = db.prepare("SELECT * FROM milestones ORDER BY m_date ASC, created_at ASC").all();
console.log(`读到 ${milestones.length} 条大事记${DRY_RUN ? "（dry-run，不写库）" : ""}`);

const findExisting = db.prepare("SELECT id FROM entries WHERE type = 'journal' AND entry_date = ? AND title = ?");
const getMediaKind = db.prepare("SELECT kind FROM media WHERE id = ?");
const insertEntry = db.prepare(
  `INSERT INTO entries (id, type, title, body, speaker, mood, entry_date, published, reveal_at, layout, ref_media, tags, created_at, updated_at)
   VALUES (?, 'journal', ?, ?, NULL, ?, ?, 1, NULL, NULL, ?, NULL, ?, ?)`
);

let created = 0;
let skipped = 0;
const run = db.transaction(() => {
  for (const m of milestones) {
    const dup = findExisting.get(m.m_date, m.title);
    if (dup) {
      console.log(`跳过（已存在） ${m.m_date} 《${m.title}》 -> ${dup.id}`);
      skipped++;
      continue;
    }
    // 只引用真实存在的照片/视频（音频、贴纸素材不进手账页）
    let ids = [];
    try {
      const parsed = JSON.parse(m.media_ids ?? "[]");
      if (Array.isArray(parsed)) ids = parsed.filter((x) => typeof x === "string");
    } catch {
      /* 坏 JSON 当空处理 */
    }
    const refs = [];
    for (const id of ids) {
      const row = getMediaKind.get(id);
      if (row && (row.kind === "photo" || row.kind === "video")) refs.push({ id, caption: null, sort: refs.length });
    }
    const id = newId();
    const now = nowISO();
    if (!DRY_RUN) {
      insertEntry.run(id, m.title, m.body ?? "", m.icon ?? null, m.m_date, refs.length ? JSON.stringify(refs) : null, now, now);
    }
    console.log(`转换 ${m.m_date} 《${m.title}》 引用 ${refs.length} 个媒体 -> ${id}`);
    created++;
  }
});
run();

console.log(`完成：新转 ${created} 条手账页，跳过 ${skipped} 条。大事记原数据未动。`);
