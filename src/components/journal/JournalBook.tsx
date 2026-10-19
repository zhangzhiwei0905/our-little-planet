"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarBlank, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { EntryWithMedia } from "@/lib/entries";
import { JournalEntryCard } from "./JournalEntryCard";

/** 翻书动画：从右侧翻进来（下一页/更早）或从左侧翻回来（上一页/更新） */
const FLIP = {
  enter: (d: number) => ({ x: d >= 0 ? 90 : -90, rotateY: d >= 0 ? -10 : 10, opacity: 0 }),
  center: { x: 0, rotateY: 0, opacity: 1 },
  exit: (d: number) => ({ x: d >= 0 ? -90 : 90, rotateY: d >= 0 ? 10 : -10, opacity: 0 }),
};

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return `${y} 年 ${Number(mo)} 月`;
}

/** 手账本：像翻纸质书一样一页一页看（手账页 + 自由拼贴页），
 *  月份贴纸跳转 + 日历直选某天；←→ 键、按钮、左右滑动都能翻；
 *  带 ?date= 进来时先翻到那一天（首页「回到那几天」用） */
export function JournalBook({ entries, author, reader = false, initialDate, seens }: { entries: EntryWithMedia[]; author: boolean; reader?: boolean; initialDate?: string; seens?: Record<string, string> }) {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0); // 0 = 最新一页，往后翻是更早的
  const [dir, setDir] = useState(0);
  const [jumpDate, setJumpDate] = useState("");
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const safeIdx = Math.min(Math.max(idx, 0), entries.length - 1);
  const entry = entries[safeIdx];

  const months = useMemo(() => {
    const m = new Map<string, number>(); // 月份 → 该月最新一页的下标
    entries.forEach((e, i) => {
      const k = e.entry_date.slice(0, 7);
      if (!m.has(k)) m.set(k, i);
    });
    return [...m.entries()]; // entries 本身按日期倒序，先见到的即该月最新
  }, [entries]);

  function go(d: 1 | -1) {
    const next = Math.min(Math.max(safeIdx + d, 0), entries.length - 1);
    if (next === safeIdx) return;
    setDir(d);
    setIdx(next);
  }

  function jumpTo(i: number) {
    if (i === safeIdx || i < 0 || i >= entries.length) return;
    setDir(i > safeIdx ? 1 : -1);
    setIdx(i);
  }

  /** 跳到某天：有当天的页就翻到（多页取最新），没有就翻到它之前最近的一页 */
  function jumpToDate(dateStr: string) {
    if (!dateStr) return;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].entry_date <= dateStr) {
        jumpTo(i);
        return;
      }
    }
    jumpTo(entries.length - 1); // 比所有页都早，翻到第一页（最旧）
  }

  // 键盘翻页
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIdx, entries.length]);

  // 带日期进来：翻到那一天（没有当天的页就翻到它之前最近的一页），只翻这一次
  const dateJumped = useRef(false);
  useEffect(() => {
    if (dateJumped.current || !initialDate || entries.length === 0) return;
    dateJumped.current = true;
    jumpToDate(initialDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDate, entries.length]);

  return (
    <div className="mt-12">
      {/* 快速跳转：月份贴纸 + 日历直选 */}
      <div className="flex flex-wrap items-center gap-2.5">
        {months.map(([m, i]) => (
          <button
            key={m}
            type="button"
            onClick={() => jumpTo(i)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-bold transition-all duration-300 ease-spring",
              entry.entry_date.startsWith(m)
                ? "-translate-y-px bg-rose-deep text-paper shadow-md"
                : "border border-ink/20 text-ink-soft hover:bg-ink/5"
            )}
          >
            {monthLabel(m)}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-3.5 py-1.5">
          <CalendarBlank className="size-4 text-ink-soft" />
          <input
            type="date"
            value={jumpDate}
            max={entries[0]?.entry_date}
            min={entries[entries.length - 1]?.entry_date}
            onChange={(e) => {
              setJumpDate(e.target.value);
              jumpToDate(e.target.value);
            }}
            aria-label="跳到某一天"
            className="bg-transparent font-round text-sm tracking-wider outline-none"
          />
        </label>
      </div>

      {/* 书页 */}
      <div className="relative mt-8">
        <AnimatePresence custom={dir} mode="wait" initial={false}>
          <motion.div
            key={entry.id}
            custom={dir}
            variants={FLIP}
            initial="enter"
            animate="center"
            exit="exit"
            transition={reduce ? { duration: 0.15 } : { duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformPerspective: 1400 }}
            className="mx-auto max-w-2xl [touch-action:pan-y]"
            onPointerDown={(e) => {
              swipe.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={(e) => {
              const s = swipe.current;
              swipe.current = null;
              if (!s) return;
              const dx = e.clientX - s.x;
              const dy = e.clientY - s.y;
              if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
            }}
          >
            <JournalEntryCard entry={entry} author={author} reader={reader} seenAt={seens?.[entry.id] ?? null} />
          </motion.div>
        </AnimatePresence>

        {/* 翻页按钮 */}
        <button
          type="button"
          aria-label="上一页（更新的）"
          disabled={safeIdx === 0}
          onClick={() => go(-1)}
          className="absolute -left-2 top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-ink/10 bg-paper text-ink-soft shadow-card transition hover:text-ink disabled:opacity-30 sm:-left-8"
        >
          <CaretLeft weight="bold" className="size-5" />
        </button>
        <button
          type="button"
          aria-label="下一页（更早的）"
          disabled={safeIdx === entries.length - 1}
          onClick={() => go(1)}
          className="absolute -right-2 top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-ink/10 bg-paper text-ink-soft shadow-card transition hover:text-ink disabled:opacity-30 sm:-right-8"
        >
          <CaretRight weight="bold" className="size-5" />
        </button>
      </div>

      {/* 页码与提示 */}
      <p className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-round text-sm tracking-widest text-ink-soft">
        <span>
          {safeIdx + 1} / {entries.length} 页
        </span>
        <span className="opacity-60">·</span>
        <span className="opacity-70">{entry.entry_date.replaceAll("-", ".")}</span>
        <span className="opacity-60">·</span>
        <span className="opacity-50">← → 键或左右滑动翻页</span>
      </p>
    </div>
  );
}
