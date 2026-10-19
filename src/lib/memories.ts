import type { EntryWithMedia } from "./entries";
import { hashCode } from "./tilt";

const DAY = 86_400_000;
/** 往回找几个月的「同一天」；窗口前后放宽几天，凑不齐整月也不漏 */
const WINDOW_DAYS = 3;
const MAX_MONTHS_BACK = 18;

export type Memory = {
  entry: EntryWithMedia;
  /** 几个月前（>=1） */
  monthsBack: number;
  /** true = 恰好是同月同日；false = 前后几天内 */
  exactDay: boolean;
  /** 「上个月的今天」「3 个月前的那几天」 */
  label: string;
};

function localISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 月份平移并夹住日号（3 月 31 日往回一个月是 2 月 28 日，不是 3 月 3 日） */
function shiftMonths(d: Date, delta: number): Date {
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return t;
}

function dayDiff(a: string, b: string): number {
  return Math.round(Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / DAY);
}

function hasPhoto(e: EntryWithMedia): boolean {
  return e.media.some((m) => m.kind === "photo");
}

function labelOf(monthsBack: number, exactDay: boolean): string {
  const suffix = exactDay ? "的今天" : "的那几天";
  if (monthsBack === 1) return `上个月${suffix}`;
  if (monthsBack < 12) return `${monthsBack} 个月前${suffix}`;
  const years = Math.floor(monthsBack / 12);
  const rest = monthsBack % 12;
  return (rest === 0 ? `${years} 年前` : `${years} 年 ${rest} 个月前`) + suffix;
}

/** 「这本本子记得」：从过去的月份里翻出一张牌。
 *  在一起的时间还短，不看「那年今日」看「N 个月前的今天」——每个月的同一天前后几天都算。
 *  同一天可能被多个月份翻中，每天固定用日期哈希挑一张，当天刷新不换、明天再翻 */
export function findMemory(entries: EntryWithMedia[], today = new Date()): Memory | null {
  const todayStr = localISO(today);
  const past = entries.filter((e) => e.entry_date < todayStr);
  if (past.length === 0) return null;

  // 每个月份只留最好的一张：同天优先，其次有照片的，其次离同天最近的
  const pool: Memory[] = [];
  for (let m = 1; m <= MAX_MONTHS_BACK; m++) {
    const target = localISO(shiftMonths(today, -m));
    let best: { entry: EntryWithMedia; diff: number } | null = null;
    for (const entry of past) {
      const diff = dayDiff(entry.entry_date, target);
      if (diff > WINDOW_DAYS) continue;
      if (!best) {
        best = { entry, diff };
        continue;
      }
      const better =
        diff < best.diff ||
        (diff === best.diff && hasPhoto(entry) && !hasPhoto(best.entry)) ||
        (diff === best.diff && hasPhoto(entry) === hasPhoto(best.entry) && entry.entry_date > best.entry.entry_date);
      if (better) best = { entry, diff };
    }
    if (best) pool.push({ entry: best.entry, monthsBack: m, exactDay: best.diff === 0, label: labelOf(m, best.diff === 0) });
  }
  if (pool.length === 0) return null;

  // 排序后取前几张做每日翻牌池：同天的排前面，离得近的月份排前面
  pool.sort((a, b) => Number(b.exactDay) - Number(a.exactDay) || a.monthsBack - b.monthsBack);
  const daily = pool.slice(0, Math.min(5, pool.length));
  return daily[hashCode(todayStr) % daily.length];
}
