import { Heart } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { tiltOf } from "@/lib/tilt";

/** 信封：未读封着火漆，读过的露出信纸一角 */
export function Envelope({
  date,
  index,
  read,
  onOpen,
}: {
  date: string;
  index: number;
  read: boolean;
  onOpen: () => void;
}) {
  const tilt = tiltOf(`${date}-${index}`, 3);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`拆开 ${date} 的信`}
      className="group block w-full cursor-pointer"
    >
      <div
        className={cn(
          "relative mx-auto aspect-[8/5] w-full max-w-[300px] rounded-lg bg-env shadow-card",
          "transition-[transform,box-shadow] duration-500 ease-spring",
          "group-hover:z-10 group-hover:[transform:rotate(0deg)_translateY(-8px)] group-hover:shadow-lifted"
        )}
        style={{ transform: `rotate(${tilt}deg)` }}
      >
        {/* 信封内侧的折线 */}
        <svg viewBox="0 0 100 62" className="absolute inset-0 h-full w-full text-env-line" fill="none" aria-hidden>
          <path d="M0 0 L50 38 L100 0" stroke="currentColor" strokeWidth="0.8" />
          <path d="M0 62 L38 30 M100 62 L62 30" stroke="currentColor" strokeWidth="0.8" />
        </svg>

        {/* 读过的信：信纸从信封口露出一截 */}
        <div
          className={cn(
            "absolute inset-x-4 top-1.5 h-7 rounded-sm bg-env-letter shadow-sm transition-all duration-500",
            read ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          )}
        >
          <p className="px-2 pt-1 font-script text-sm leading-none text-ink-soft/70">for you</p>
        </div>

        {/* 翻盖：未读盖实，读过的半开 */}
        <div
          className={cn(
            "envelope-flap absolute inset-x-0 top-0 h-[58%] rounded-t-lg bg-env-flap transition-all duration-500",
            read && "-translate-y-1.5 opacity-70"
          )}
        />

        {/* 火漆封印：未读完整，读过的褪开 */}
        <span
          className={cn(
            "wax-seal absolute left-1/2 top-[58%] grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center transition-all duration-500",
            read && "scale-75 opacity-50"
          )}
        >
          <Heart weight="fill" className="size-4 text-cream/90" />
        </span>

        {/* 信封落款 */}
        <div className="absolute inset-x-4 bottom-2 flex items-end justify-between">
          <p className="font-script text-xl leading-none text-ink/80">{date.replaceAll("-", ".")}</p>
          <p className="font-round text-[11px] tracking-[0.2em] text-ink-soft">No.{index + 1}</p>
        </div>
      </div>
    </button>
  );
}
