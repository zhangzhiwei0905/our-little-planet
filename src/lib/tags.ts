import { NOTE_COLORS, NOTE_TONES, pickOf, type NoteTone } from "./tilt";

/** 相册标签：「青海之行」这类贴在照片上的小贴纸；
 *  存在 entries.tags（JSON 字符串数组），一页最多 8 个、单个最长 20 字 */

export const MAX_TAGS_PER_ENTRY = 8;
export const TAG_MAX_LEN = 20;

/** entries.tags 列（JSON 字符串）安全解析成 string[] */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, MAX_TAGS_PER_ENTRY);
  } catch {
    return [];
  }
}

/** 清洗要入库的标签：去首尾空格、去空、去重、限数量和长度 */
export function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of input) {
    if (typeof t !== "string") continue;
    const s = t.trim().slice(0, TAG_MAX_LEN).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_TAGS_PER_ENTRY) break;
  }
  return out;
}

/** 标签的专属便签色：同一个标签不管贴到哪儿都是同一个颜色（按名字哈希稳定挑） */
export function tagTone(tag: string): NoteTone {
  return pickOf(tag, NOTE_TONES);
}

export function tagColor(tag: string): string {
  return NOTE_COLORS[tagTone(tag)];
}
