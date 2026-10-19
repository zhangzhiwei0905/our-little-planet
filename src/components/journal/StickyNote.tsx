import { cn } from "@/lib/cn";
import { NOTE_COLORS, type NoteTone } from "@/lib/tilt";
import { WashiTape } from "./WashiTape";

/** 便利贴：贴在页面上的一句她说过的话 */
export function StickyNote({
  text,
  speaker,
  date,
  tilt = 2,
  tone = "butter",
  className,
  children,
}: {
  text?: string;
  speaker?: string | null;
  date?: string | null;
  tilt?: number;
  tone?: NoteTone;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn("sticky-note px-5 pt-4 pb-5", className)}
      style={{ "--tone": NOTE_COLORS[tone], transform: `rotate(${tilt}deg)` } as React.CSSProperties}
    >
      <WashiTape tone="rose" rotate={tilt > 0 ? -5 : 5} className="-top-2.5 left-1/2 scale-75" />
      {text && <p className="font-hand text-[1.05rem] leading-relaxed">{text}</p>}
      {children}
      {(speaker || date) && (
        <p className="mt-2 flex items-center gap-2 font-round text-xs tracking-wider text-ink/60">
          {speaker && <span>{speaker}</span>}
          {date && <span className="opacity-70">{date.replaceAll("-", ".")}</span>}
        </p>
      )}
    </div>
  );
}
