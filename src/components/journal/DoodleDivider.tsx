import { cn } from "@/lib/cn";
import { Sticker } from "./Sticker";

/** 手绘风分隔线 */
export function DoodleDivider({
  variant = "wave",
  className,
}: {
  variant?: "wave" | "hearts";
  className?: string;
}) {
  if (variant === "hearts") {
    return (
      <div className={cn("flex items-center justify-center gap-2.5 text-rose/70", className)} aria-hidden>
        <Sticker name="heart" className="size-4" />
        <Sticker name="heart" className="size-3 opacity-60" />
        <Sticker name="heart" className="size-4" />
      </div>
    );
  }
  return (
    <svg viewBox="0 0 120 12" className={cn("h-3 w-40 text-ink/25", className)} fill="none" aria-hidden>
      <path
        d="M0 8 Q 7.5 0 15 8 T 30 8 T 45 8 T 60 8 T 75 8 T 90 8 T 105 8 T 120 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
