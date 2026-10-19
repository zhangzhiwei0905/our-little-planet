"use client";

import { useEffect, useMemo, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 在一起 N 天：进场时数字从 0 滚动上来，像日历一页页翻过 */
export function DayCounter({ startDate, className }: { startDate: string; className?: string }) {
  const days = useMemo(() => {
    const start = new Date(`${startDate}T00:00:00`);
    if (Number.isNaN(start.getTime())) return null;
    return Math.max(1, Math.floor((startOfDay(new Date()) - startOfDay(start)) / 86_400_000) + 1);
  }, [startDate]);

  const reduce = useReducedMotion();
  const [n, setN] = useState<number | null>(reduce ? days : 0);
  const shown = n ?? 0;

  useEffect(() => {
    if (days === null || reduce) return;
    const controls = animate(0, days, {
      duration: 1.8,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setN(Math.round(v)),
    });
    return () => controls.stop();
  }, [days, reduce]);

  if (days === null) return null;
  return (
    <div className={cn("select-none", className)}>
      <div className="flex flex-wrap items-end gap-2">
        <span className="pb-2 text-lg text-ink-soft">在一起的第</span>
        <span className="font-round text-7xl font-bold leading-none text-rose-deep tabular-nums sm:text-8xl">
          {shown ?? 0}
        </span>
        <span className="pb-2 text-lg text-ink-soft">天</span>
      </div>
      <p className="mt-3 font-script text-2xl text-ink-soft/80">
        since {startDate.replaceAll("-", ".")} · 每一天都算数
      </p>
    </div>
  );
}
