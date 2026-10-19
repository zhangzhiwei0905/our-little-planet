"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { Sticker } from "@/components/journal/Sticker";
import { useMounted } from "@/lib/use-mounted";

/** 全屏 3D 翻书过场：
 *  phase="opening" —— 合着的本子封面朝左翻开（解锁进本子）；
 *  phase="closing" —— 摊开的本子封面合上（合上本子离开）。
 *  动画播完回调 onDone（父母拿它做跳转）。减少动态偏好直接跳过。
 *  必须 portal 到 body：调用方（LockForm 自己就在 rotateY）带 transform，
 *  fixed 遮罩会被困在卡片里——Lightbox 踩过同一个坑 */
export function BookFlip({ phase, onDone }: { phase: "opening" | "closing"; onDone: () => void }) {
  const mounted = useMounted();
  const reduce = useReducedMotion();
  // closing 从摊开合上，opening 从合着翻开
  const [open, setOpen] = useState(phase === "closing");
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (reduce) {
      doneRef.current();
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (phase === "opening") {
      timers.push(setTimeout(() => setOpen(true), 280)); // 先看清合着的封面，再翻开
      timers.push(setTimeout(() => doneRef.current(), 280 + 900 + 200));
    } else {
      timers.push(setTimeout(() => setOpen(false), 140)); // 先看清摊开的内页，再合上
      timers.push(setTimeout(() => doneRef.current(), 140 + 820 + 280));
    }
    return () => timers.forEach(clearTimeout);
  }, [phase, reduce]);

  if (!mounted) return null;
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[90] grid place-items-center bg-ink/85 [perspective:1800px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      aria-hidden
    >
      <div className="relative h-[min(66vh,460px)] w-[min(76vw,330px)] [transform-style:preserve-3d]">
        {/* 内页：一叠纸，顶页画几道手账线条 */}
        <div className="absolute inset-0 [transform-style:preserve-3d]">
          <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-r-2xl bg-paper-deep shadow-card" />
          <div className="absolute inset-0 translate-x-1 translate-y-1 rounded-r-2xl bg-paper-warm" />
          <div className="absolute inset-0 overflow-hidden rounded-r-2xl bg-paper shadow-lifted">
            <div className="absolute inset-y-0 left-0 w-4 bg-paper-deep/80" />
            <div className="flex h-full flex-col items-center justify-center gap-4 pl-6 pr-8">
              <p className="font-script text-3xl text-ink/85">我们的故事</p>
              <div className="flex w-4/5 flex-col gap-3">
                <div className="h-1.5 w-full rounded-full bg-ink/10" />
                <div className="h-1.5 w-11/12 rounded-full bg-ink/10" />
                <div className="h-1.5 w-3/5 rounded-full bg-ink/10" />
              </div>
              <Sticker name="heart" className="size-8 rotate-6 text-rose/70" />
              <p className="font-hand text-sm tracking-[0.2em] text-ink-soft/60">
                {phase === "opening" ? "翻开啦，都在里面" : "合上本子，明天继续写"}
              </p>
            </div>
          </div>
        </div>

        {/* 封面：绕左侧书脊翻转；正面是布面设计，背面是内封纸色 */}
        <motion.div
          className="absolute inset-0 [transform-origin:left_center] [transform-style:preserve-3d]"
          initial={false}
          animate={{ rotateY: open ? -166 : 0 }}
          transition={{
            duration: phase === "opening" ? 0.9 : 0.82,
            ease: phase === "opening" ? [0.22, 0.9, 0.3, 1] : [0.5, 0.05, 0.32, 1],
          }}
        >
          <div className="absolute inset-0 overflow-hidden rounded-l-md rounded-r-2xl bg-gradient-to-br from-rose-deep via-[#96405d] to-[#74304a] shadow-lifted [backface-visibility:hidden]">
            <div className="absolute inset-y-0 left-0 w-4 bg-ink/30" />
            <div className="absolute inset-3 rounded-xl border border-paper/25" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 pl-5">
              <span className="font-script text-5xl leading-none text-paper/95 rotate-[2deg]">我们俩</span>
              <span className="font-hand text-sm tracking-[0.45em] text-paper/75 pl-[0.45em]">的手账</span>
              <Sticker name="star" className="mt-3 size-6 -rotate-6 text-butter/85" />
            </div>
          </div>
          <div className="absolute inset-0 rounded-l-2xl rounded-r-md bg-paper-deep shadow-card [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <div className="absolute inset-y-0 right-0 w-4 bg-ink/10" />
          </div>
        </motion.div>
      </div>
    </motion.div>,
    document.body
  );
}
