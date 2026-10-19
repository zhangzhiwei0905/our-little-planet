import { db } from "./db";
import { sanitizeTags } from "./tags";

/** 全局标签库：任何地方输入过的标签都在这儿，别处能直接选 */

export function listAllTags(): string[] {
  return (db.prepare("SELECT name FROM tags ORDER BY name").all() as { name: string }[]).map((r) => r.name);
}

/** 标签入库（幂等）：任何保存标签的地方顺手调一下，保证库里不缺 */
export function upsertTags(input: string[]): void {
  const clean = sanitizeTags(input);
  if (clean.length === 0) return;
  const stmt = db.prepare("INSERT OR IGNORE INTO tags (name, created_at) VALUES (?, ?)");
  const now = new Date().toISOString();
  for (const t of clean) stmt.run(t, now);
}

/** 全局删一个标签：从标签库 + 所有媒体/条目上一起撕掉 */
export function deleteTagEverywhere(name: string): void {
  const t = name.trim().slice(0, 20).trim();
  if (!t) return;
  db.prepare("DELETE FROM tags WHERE name = ?").run(t);
  const strip = (raw: string): string | null => {
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return null;
      return JSON.stringify(arr.filter((x) => x !== t));
    } catch {
      return null;
    }
  };
  for (const row of db.prepare("SELECT id, tags FROM media WHERE tags IS NOT NULL").all() as { id: string; tags: string }[]) {
    const next = strip(row.tags);
    if (next !== null && next !== row.tags) db.prepare("UPDATE media SET tags = ? WHERE id = ?").run(next, row.id);
  }
  for (const row of db.prepare("SELECT id, tags FROM entries WHERE tags IS NOT NULL").all() as { id: string; tags: string }[]) {
    const next = strip(row.tags);
    if (next !== null && next !== row.tags) db.prepare("UPDATE entries SET tags = ? WHERE id = ?").run(next, row.id);
  }
}
