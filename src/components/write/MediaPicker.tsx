"use client";

import { useMemo, useState } from "react";
import { CalendarBlank, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { AlbumPickThumb } from "./AlbumPickThumb";
import type { AlbumPickItem } from "./MilestoneManager";

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return `${y} 年 ${Number(mo)} 月`;
}

/** 筛选贴上的数量小徽章 */
function CountBadge({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={cn(
        "grid min-w-4 place-items-center rounded-full px-1 font-round text-[10px] font-bold leading-4",
        active ? "bg-paper/25 text-paper" : "bg-ink/10 text-ink-soft"
      )}
    >
      {n}
    </span>
  );
}

const pillCls = (on: boolean) =>
  cn(
    "flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold transition-all duration-300 ease-spring",
    on ? "-translate-y-px bg-rose-deep text-paper shadow-sm" : "border border-ink/20 text-ink-soft hover:bg-ink/5"
  );

/** 三层命中判断放模块层：useMemo 里引用组件内函数会被 exhaustive-deps 盯上 */
const hitTime = (p: AlbumPickItem, month: string, day: string) =>
  !p.entryDate || ((month === "all" || p.entryDate.startsWith(month)) && (day === "" || p.entryDate === day));
const hitTag = (p: AlbumPickItem, tag: string) => tag === "all" || (p.tags ?? []).includes(tag);
const hitKind = (p: AlbumPickItem, kind: "all" | "photo" | "video") =>
  kind === "all" || (kind === "photo" ? p.kind !== "video" : p.kind === "video");

/** 从本子里勾选照片/视频：月份/具体日期/类型/标签四级筛选（计数和相册墙一样级联），
 *  筛选只影响看得到哪些，已经勾上的编号和顺序不受影响。大事记和彩蛋共用 */
export function MediaPicker({
  items,
  selected,
  onToggle,
  emptyHint,
}: {
  items: AlbumPickItem[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyHint: string;
}) {
  const [month, setMonth] = useState("all");
  const [day, setDay] = useState("");
  const [tag, setTag] = useState("all");
  const [kind, setKind] = useState<"all" | "photo" | "video">("all");

  const months = useMemo(() => {
    // 计数口径：类型 + 标签筛选下的各月数量（选了具体某天时网格里只显示那天）
    const set = new Map<string, number>();
    for (const p of items) {
      if (!p.entryDate) continue;
      if (!hitKind(p, kind) || !hitTag(p, tag)) continue;
      const m = p.entryDate.slice(0, 7);
      set.set(m, (set.get(m) ?? 0) + 1);
    }
    return [...set.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [items, kind, tag]);

  const tags = useMemo(() => {
    const set = new Map<string, number>();
    for (const p of items) {
      if (!hitTime(p, month, day) || !hitKind(p, kind)) continue;
      for (const t of p.tags ?? []) set.set(t, (set.get(t) ?? 0) + 1);
    }
    return [...set.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  }, [items, month, day, kind]);

  const photoN = useMemo(
    () => items.filter((p) => hitTime(p, month, day) && hitTag(p, tag) && p.kind !== "video").length,
    [items, month, day, tag]
  );
  const videoN = useMemo(
    () => items.filter((p) => hitTime(p, month, day) && hitTag(p, tag) && p.kind === "video").length,
    [items, month, day, tag]
  );
  const monthAllN = useMemo(
    () => items.filter((p) => (day === "" || p.entryDate === day) && hitKind(p, kind) && hitTag(p, tag)).length,
    [items, day, kind, tag]
  );

  const shown = useMemo(
    () => items.filter((p) => hitTime(p, month, day) && hitTag(p, tag) && hitKind(p, kind)),
    [items, month, day, tag, kind]
  );
  const selectedVisible = useMemo(() => selected.filter((id) => shown.some((p) => p.id === id)).length, [selected, shown]);

  if (items.length === 0) {
    return (
      <div className="grid max-h-72 grid-cols-3 gap-3 overflow-y-auto rounded-2xl border border-ink/10 bg-paper p-3 sm:grid-cols-4 lg:grid-cols-5">
        <p className="col-span-full py-8 text-center text-sm text-ink-soft">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {/* 月份 + 具体某天 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setMonth("all");
            setDay("");
          }}
          className={pillCls(month === "all")}
        >
          全部
          <CountBadge n={monthAllN} active={month === "all"} />
        </button>
        {months.map(([m, n]) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMonth(m);
              setDay("");
            }}
            className={pillCls(month === m)}
          >
            {monthLabel(m)}
            <CountBadge n={n} active={month === m} />
          </button>
        ))}
        <span className={cn("flex items-center gap-1 rounded-full border px-2.5 py-1 transition", day ? "border-rose-deep/60 bg-rose-soft/50" : "border-ink/20")}>
          <CalendarBlank weight="bold" className="size-3 text-ink-soft" />
          <input
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              if (e.target.value) setMonth(e.target.value.slice(0, 7));
            }}
            aria-label="按具体日期筛选"
            className="bg-transparent font-round text-xs font-bold text-ink outline-none"
          />
          {day && (
            <button type="button" onClick={() => setDay("")} aria-label="清除日期筛选" className="grid size-4 place-items-center rounded-full text-ink-soft transition hover:bg-ink/10 hover:text-ink">
              <X weight="bold" className="size-2.5" />
            </button>
          )}
        </span>
      </div>

      {/* 类型（照片含 Live 图）+ 标签 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ["all", `全部 ${photoN + videoN}`],
            ["photo", `照片 ${photoN}`],
            ["video", `视频 ${videoN}`],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setKind(value)} className={pillCls(kind === value)}>
            {label}
          </button>
        ))}
        {tags.length > 0 && <span className="mx-1 h-4 w-px bg-ink/15" aria-hidden />}
        {tag !== "all" && (
          <button type="button" onClick={() => setTag("all")} className={pillCls(false)}>
            全部标签
          </button>
        )}
        {tags.map(([t, n]) => (
          <button key={t} type="button" onClick={() => setTag(t)} className={pillCls(tag === t)}>
            {t}
            <CountBadge n={n} active={tag === t} />
          </button>
        ))}
      </div>

      {selected.length > 0 && selectedVisible < selected.length && (
        <p className="font-round text-[11px] font-bold text-ink-soft">
          已选 {selected.length} 个，当前筛选下只看得到其中 {selectedVisible} 个——被筛掉的仍保持勾选
        </p>
      )}

      <div className="grid max-h-72 grid-cols-3 gap-3 overflow-y-auto rounded-2xl border border-ink/10 bg-paper p-3 sm:grid-cols-4 lg:grid-cols-5">
        {shown.map((p) => {
          const idx = selected.indexOf(p.id);
          const on = idx >= 0;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onToggle(p.id)}
              aria-pressed={on}
              title={p.caption ?? ""}
              className={cn(
                "relative overflow-hidden rounded-lg border-2 transition-all duration-200",
                on ? "border-rose-deep shadow-md" : "border-transparent opacity-70 hover:opacity-100"
              )}
            >
              <AlbumPickThumb item={p} />
              {p.kind === "video" && (
                <span className="absolute left-1 top-1 rounded-full bg-ink/55 px-1.5 py-0.5 text-[9px] font-bold text-paper">视频</span>
              )}
              {on && (
                <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-rose-deep text-paper">{idx + 1}</span>
              )}
            </button>
          );
        })}
        {shown.length === 0 && <p className="col-span-full py-8 text-center text-sm text-ink-soft">这个筛选下没有照片/视频，换个条件试试</p>}
      </div>
    </div>
  );
}
