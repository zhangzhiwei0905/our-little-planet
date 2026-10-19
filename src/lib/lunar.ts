import solarLunar from "solarlunar";

/** 农历 → 公历的薄封装：七夕、元宵这类农历节日要靠它落到公历日历上。
 *  solarlunar 自带 1900–2100 的农历数据，超出范围返回 null */
export function lunarToSolar(lunarYear: number, lunarMonth: number, lunarDay: number): Date | null {
  const r = solarLunar.lunar2solar(lunarYear, lunarMonth, lunarDay, false);
  if (r === -1) return null;
  return new Date(r.cYear, r.cMonth - 1, r.cDay);
}
