"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { daysBetween, nextSpecialDay, specialDaysInYear, type SpecialDay, type SpecialDayKind } from "@/lib/special-days";
import { Sticker, type StickerName } from "@/components/journal/Sticker";
import { WashiTape } from "@/components/journal/WashiTape";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 各种日子在列表里配的小贴纸 */
const KIND_ICON: Record<SpecialDayKind, StickerName> = {
  milestone: "heart",
  anniversary: "star",
  festival: "flower",
};

function fmtYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function countdownText(today: string, date: string): { text: string; isToday: boolean } {
  const diff = daysBetween(today, date);
  if (diff === 0) return { text: "就是今天", isToday: true };
  if (diff > 0) return { text: `还有 ${diff} 天`, isToday: false };
  return { text: `已过 ${-diff} 天`, isToday: false };
}

/** 首页「重要的日子」月历：从在一起的纪念日推整百天 / 520 / 1314 / 周年，
 *  再叠上情人节、520、元宵、七夕，翻月看哪天有记号、还差几天到 */
export function AnniversaryCalendar({ startDate, today: initialToday }: { startDate: string; today: string }) {
  const [view, setView] = useState(() => ({ y: Number(initialToday.slice(0, 4)), m: Number(initialToday.slice(5, 7)) - 1 }));

  // 今天是哪天只有浏览器知道：水合前用服务端传入的日期（和 SSR 标记一致），
  // 水合后切到浏览器本地日期，服务器和浏览器跨日零点时不闪不错
  const noopSubscribe = () => () => undefined;
  const today = useSyncExternalStore(
    noopSubscribe,
    () => {
      const n = new Date();
      return fmtYmd(n.getFullYear(), n.getMonth(), n.getDate());
    },
    () => initialToday
  );

  const yearDays = useMemo(() => specialDaysInYear(view.y, startDate), [view.y, startDate]);
  const monthKey = `${view.y}-${String(view.m + 1).padStart(2, "0")}`;
  const monthDays = useMemo(() => yearDays.filter((d) => d.date.startsWith(monthKey)), [yearDays, monthKey]);
  const byDay = useMemo(() => {
    const m = new Map<number, SpecialDay[]>();
    for (const d of monthDays) {
      const day = Number(d.date.slice(8, 10));
      m.set(day, [...(m.get(day) ?? []), d]);
    }
    return m;
  }, [monthDays]);
  const next = useMemo(() => nextSpecialDay(today, startDate), [today, startDate]);

  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function shiftMonth(delta: 1 | -1) {
    setView((v) => {
      const m = v.m + delta;
      if (m < 0) return { y: v.y - 1, m: 11 };
      if (m > 11) return { y: v.y + 1, m: 0 };
      return { ...v, m };
    });
  }

  const atLowerBound = view.y <= 1901 && view.m === 0; // solarlunar 农历数据只到 2100 年
  const atUpperBound = view.y >= 2099 && view.m === 11;

  return (
    <section className="mt-16 py-8" aria-label="重要的日子">
      <div className="mb-7 flex items-end justify-between gap-4">
        <h2 className="text-3xl font-bold">重要的日子</h2>
        {next && (
          <p className="font-round text-sm tracking-wider text-ink-soft">
            下一个 · <span className="font-bold text-rose-deep">{next.label}</span> ·{" "}
            {countdownText(today, next.date).text}
          </p>
        )}
      </div>

      <div className="card-paper mx-auto max-w-md px-6 py-7">
        <WashiTape tone="rose" className="-top-3 left-1/2" />

        {/* 月份切换 */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label="上一个月"
            disabled={atLowerBound}
            onClick={() => shiftMonth(-1)}
            className="grid size-9 place-items-center rounded-full border border-ink/15 text-ink-soft transition hover:bg-ink/5 hover:text-ink disabled:opacity-30"
          >
            <CaretLeft weight="bold" className="size-5" />
          </button>
          <div className="text-center">
            <p className="font-script text-3xl leading-none text-rose-deep">
              {view.y} 年 {view.m + 1} 月
            </p>
            <p className="mt-1.5 font-round text-[9px] tracking-[0.32em] text-ink-soft/70">MARKED DAYS · 都是要一起过的日子</p>
          </div>
          <button
            type="button"
            aria-label="下一个月"
            disabled={atUpperBound}
            onClick={() => shiftMonth(1)}
            className="grid size-9 place-items-center rounded-full border border-ink/15 text-ink-soft transition hover:bg-ink/5 hover:text-ink disabled:opacity-30"
          >
            <CaretRight weight="bold" className="size-5" />
          </button>
        </div>

        <motion.div
          key={monthKey}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* 星期表头 */}
          <div className="mt-6 grid grid-cols-7">
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={cn("pb-2 text-center font-round text-xs font-semibold", i === 0 || i === 6 ? "text-rose-deep/60" : "text-ink-soft")}>
                {w}
              </span>
            ))}
          </div>

          {/* 日期格：纪念日实心玫瑰圆、节日数字染玫瑰加小点、今天虚线圈 */}
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (day === null) return <div key={i} />;
              const evs = byDay.get(day);
              const ours = evs?.some((e) => e.kind !== "festival");
              const isToday = fmtYmd(view.y, view.m, day) === today;
              return (
                <div key={i} className="grid place-items-center py-0.5">
                  <span
                    title={evs?.map((e) => e.label).join(" · ")}
                    className={cn(
                      "relative grid size-9 place-items-center rounded-full font-round text-sm",
                      ours
                        ? "bg-rose-deep font-bold text-paper shadow-sm"
                        : evs
                          ? "font-bold text-rose-deep"
                          : "text-ink",
                      isToday && (ours
                        ? "ring-2 ring-rose-deep/50 ring-offset-2 ring-offset-card"
                        : "border-2 border-dashed border-rose-deep/80 font-bold")
                    )}
                  >
                    {day}
                    {evs && !ours && <span className="absolute bottom-0.5 size-1 rounded-full bg-rose-deep/70" />}
                  </span>
                </div>
              );
            })}
          </div>

          {/* 图例 */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-round text-[10px] tracking-wider text-ink-soft">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-rose-deep" />
              我们的日子
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-rose-deep/70" />
              节日
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full border border-dashed border-rose-deep/70" />
              今天
            </span>
          </div>

          {/* 这个月的日子清单 */}
          {monthDays.length > 0 ? (
            <ul className="mt-5">
              {monthDays.map((e) => {
                const d = new Date(e.date + "T00:00:00");
                const cd = countdownText(today, e.date);
                return (
                  <li key={e.date + e.label} className="flex items-center justify-between gap-3 border-t border-dashed border-ink/15 py-2.5">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Sticker name={KIND_ICON[e.kind]} className="size-4.5 shrink-0 text-rose-deep/70" />
                      <span className="min-w-0">
                        <span className="block font-round text-sm font-semibold text-ink">{e.label}</span>
                        <span className="block font-hand text-xs text-ink-soft">
                          {d.getMonth() + 1} 月 {d.getDate()} 日 · 周{WEEKDAYS[d.getDay()]}
                        </span>
                      </span>
                    </span>
                    <span className={cn("shrink-0 font-round text-sm font-bold tabular-nums", cd.isToday ? "text-rose-deep" : "text-ink-soft")}>
                      {cd.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-5 border-t border-dashed border-ink/15 pt-4 text-center font-script text-2xl text-ink-soft/70">
              这个月没有标上记号的日子，普通地在一起也很好
            </p>
          )}
        </motion.div>
      </div>
    </section>
  );
}
