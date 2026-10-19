import { pickOf } from "@/lib/tilt";
import { cn } from "@/lib/cn";

/** 糖分评级：内容越足等级越高，永远不低于 S——差集是不存在的。
 *  约 1/6 的集数按 id 稳定地显示「爆表」，比字母更有综艺味 */
export function gradeOf(id: string, mediaN: number, bodyLen: number): string {
  if (pickOf(id, [false, false, false, false, false, true])) return "爆表";
  if (mediaN >= 3) return "SSS";
  if (bodyLen >= 40) return "SS";
  return "S";
}

/** 集数牌：EP.07，和日期章排在一起 */
export function EpisodeChip({ ep, className }: { ep: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex -rotate-2 items-center rounded-full border border-rose-deep/40 bg-paper/70 px-2 py-0.5 font-round text-[11px] font-bold tracking-[0.15em] text-rose-deep",
        className
      )}
    >
      EP.{String(ep).padStart(2, "0")}
    </span>
  );
}

/** 糖分章：盖在便利贴右上角的红墨小圆章（位置和样式在 globals.css 的 .grade-stamp） */
export function GradeStamp({ grade }: { grade: string }) {
  return (
    <span className="grade-stamp" aria-label={`本集糖分 ${grade}`}>
      <span className="font-round text-[8px] font-semibold leading-none tracking-[0.18em]">本集糖分</span>
      <span className={cn("mt-0.5 font-script leading-none", grade.length > 1 ? "text-base" : "text-xl")}>{grade}</span>
    </span>
  );
}
