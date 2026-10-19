import { cn } from "@/lib/cn";

/** 日期章：像盖在手账上的小邮戳 */
export function DateStamp({ date, className }: { date: string; className?: string }) {
  return <span className={cn("datestamp", className)}>{date.replaceAll("-", ".")}</span>;
}

/** 月份圆章：手账里每个月的分隔章 */
export function MonthStamp({ month, className }: { month: string; className?: string }) {
  // month: "2026-05"
  const [y, m] = month.split("-");
  return (
    <span className={cn("stamp-circle", className)}>
      <span className="font-round text-lg font-bold leading-none">{Number(m)}月</span>
      <span className="font-round text-[10px] tracking-[0.2em] leading-none opacity-70 mt-1">{y}</span>
    </span>
  );
}
