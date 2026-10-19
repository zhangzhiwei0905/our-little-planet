"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowsClockwise, MagnifyingGlassPlus } from "@phosphor-icons/react";
import { PolaroidCard } from "@/components/journal/PolaroidCard";
import { cn } from "@/lib/cn";
import type { TapeTone } from "@/lib/tilt";

/** 首页大拍立得：点一下 3D 翻到背面——手写的一句话 + 日期章，像真的把照片翻过来；
 *  再点翻回正面。背面带「放大看」按钮（进灯箱）。翻着背面时通知外层暂停自动轮换 */
export function FlipPolaroid({
  src,
  caption,
  note,
  date,
  alt,
  tilt,
  tone,
  liveVideo,
  onZoom,
  onFlipChange,
}: {
  src: string;
  caption: string | null;
  /** 照片条目的那句话（caption 没有时用它） */
  note: string | null;
  date: string;
  alt: string;
  tilt: number;
  tone: TapeTone;
  liveVideo?: string | null;
  onZoom: () => void;
  onFlipChange?: (flipped: boolean) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    onFlipChange?.(flipped);
  }, [flipped, onFlipChange]);

  const back = caption?.trim() || note?.trim() || "这一天，被好好收进了本子里。";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={flipped ? "翻回正面" : "翻到背面看看"}
      className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-rose/60 focus-visible:ring-offset-4 [perspective:1400px]"
      onClick={() => setFlipped((f) => !f)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setFlipped((f) => !f);
        }
      }}
    >
      {/* 静态倾斜层：和 rotateY 翻面分开，不然 motion 会把 transform 整个接管 */}
      <div style={{ transform: `rotate(${tilt}deg)` }}>
        <motion.div
          className="relative [transform-style:preserve-3d]"
          initial={false}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={reduce ? { duration: 0.15 } : { duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        >
        {/* 正面：拍立得（自带 tilt，这里外层不再重复转） */}
        <div className="[backface-visibility:hidden]">
          <PolaroidCard
            src={src}
            caption={caption ?? "我们的拍立得"}
            alt={alt}
            tilt={0}
            tone={tone}
            tape="center"
            liveVideo={liveVideo}
            captionLines={1}
          />
        </div>

        {/* 背面：奶油纸 + 手写的一句话 + 日期章 */}
        <div
          aria-hidden={!flipped}
          className={cn(
            "absolute inset-0 flex [backface-visibility:hidden] [transform:rotateY(180deg)]",
            "flex-col items-center justify-center gap-5 bg-white px-6 py-5 shadow-card"
          )}
        >
          <p className="max-h-40 overflow-hidden text-center font-script text-2xl leading-snug text-ink/90 sm:text-[1.7rem]">
            {back}
          </p>
          <span className="datestamp">{date.replaceAll("-", ".")}</span>
          <span className="absolute bottom-2.5 left-0 right-0 flex items-center justify-center gap-1 font-round text-[10px] font-bold tracking-widest text-ink-soft/50">
            <ArrowsClockwise weight="bold" className="size-3" />
            点一下翻回去
          </span>
          <button
            type="button"
            aria-label="放大看这张照片"
            onClick={(e) => {
              e.stopPropagation();
              onZoom();
            }}
            className="absolute right-2 top-2 grid size-8 place-items-center rounded-full text-ink-soft/60 transition hover:bg-ink/5 hover:text-ink"
          >
            <MagnifyingGlassPlus weight="bold" className="size-4" />
          </button>
        </div>
        </motion.div>
      </div>
    </div>
  );
}
