import { lunarToSolar } from "./lunar";

export type SpecialDayKind = "milestone" | "anniversary" | "festival";

export type SpecialDay = {
  /** 公历日期 YYYY-MM-DD */
  date: string;
  /** 展示名，如「100 天纪念日」「一周年」「七夕」 */
  label: string;
  kind: SpecialDayKind;
};

/** 天数里程碑：整百天到 1000，520 / 1314 的谐音彩蛋，之后每 1000 天一枚。
 *  「第 N 天」的数法和首页 DayCounter 一致：在一起当天是第 1 天，
 *  所以 N 天纪念日 = 纪念日 + (N - 1) 天 */
const DAY_MILESTONES: number[] = [
  ...Array.from({ length: 10 }, (_, i) => (i + 1) * 100),
  520,
  1314,
  ...Array.from({ length: 9 }, (_, i) => (i + 2) * 1000),
];

/** 农历节日（按农历年的固定月日）：元宵也是老情人节，和七夕一起收进来 */
const LUNAR_FESTIVALS: { month: number; day: number; label: string }[] = [
  { month: 1, day: 15, label: "元宵节" },
  { month: 7, day: 7, label: "七夕" },
];

/** 公历节日：一年里固定的恋爱节日 */
const SOLAR_FESTIVALS: { month: number; day: number; label: string }[] = [
  { month: 2, day: 14, label: "情人节" },
  { month: 5, day: 20, label: "520" },
];

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function parseStart(startDate: string): Date | null {
  const d = new Date(`${startDate}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 1–99 的中文数字；只有单独的 2 说「两」（两周年），21、22 这类组合数仍用「二」 */
function cnNum(n: number): string {
  if (n === 2) return "两";
  if (n < 10) return CN_DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const head = tens === 1 ? "十" : CN_DIGITS[tens] + "十";
  return ones ? head + CN_DIGITS[ones] : head;
}

/** 一年里值得贴在日历上的日子：从在一起的纪念日推天数里程碑和周年，再叠上固定的恋爱节日 */
export function specialDaysInYear(year: number, startDate: string): SpecialDay[] {
  const out: SpecialDay[] = [];
  const start = parseStart(startDate);

  if (start) {
    for (const n of DAY_MILESTONES) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + n - 1);
      if (d.getFullYear() !== year) continue;
      out.push({ date: fmt(d), label: n === 1314 ? "1314 天 · 一生一世" : `${n} 天纪念日`, kind: "milestone" });
    }
    const years = year - start.getFullYear();
    if (years >= 1) {
      out.push({ date: fmt(new Date(year, start.getMonth(), start.getDate())), label: `${cnNum(years)}周年`, kind: "anniversary" });
    }
  }

  for (const f of SOLAR_FESTIVALS) {
    out.push({ date: `${year}-${String(f.month).padStart(2, "0")}-${String(f.day).padStart(2, "0")}`, label: f.label, kind: "festival" });
  }
  for (const f of LUNAR_FESTIVALS) {
    // 农历 year 年的元宵/七夕都落在公历 year 年内（春节最早 1 月 21 日、最晚 2 月 20 日）
    const d = lunarToSolar(year, f.month, f.day);
    if (d && d.getFullYear() === year) out.push({ date: fmt(d), label: f.label, kind: "festival" });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 距离今天最近的一个未来日子（含今天），跨年扫描；找不到（纪念日无效）返回 null */
export function nextSpecialDay(today: string, startDate: string): SpecialDay | null {
  const y0 = Number(today.slice(0, 4));
  const all: SpecialDay[] = [];
  for (let y = y0 - 1; y <= y0 + 2; y++) all.push(...specialDaysInYear(y, startDate));
  const future = all.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  return future[0] ?? null;
}

/** 两个 YYYY-MM-DD 相差几天（to - from） */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseYmd(to) - parseYmd(from)) / 86_400_000);
}
