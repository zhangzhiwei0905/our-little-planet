"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Sparkle } from "@phosphor-icons/react";

const PLAYED_KEY = "journal-intro-played";
const DURATION_MS = 2600;

const emptySubscribe = () => () => {};
const serverSnapshot = () => false;

/** 综艺片头：每台设备每个会话只播一次（刷新/切页不再打扰），
 *  点任意处或按任意键立刻跳过；开了「减少动态」直接不播。
 *  播不播由 sessionStorage 决定——它只在浏览器里有，所以走
 *  useSyncExternalStore 的客户端快照，服务端永远渲染「不播」，不会闪也不会 hydration 错位 */
export function TimelineIntro({ season, eps }: { season: number | null; eps: number }) {
  const reduced = useReducedMotion();
  const shouldPlay = useSyncExternalStore(
    emptySubscribe,
    () => {
      if (reduced) return false;
      try {
        return !sessionStorage.getItem(PLAYED_KEY);
      } catch {
        return true;
      }
    },
    serverSnapshot
  );
  // 只有「已跳过」一个状态，而且只在定时器/事件回调里翻转，effect 里不同步 setState
  const [dismissed, setDismissed] = useState(false);
  const show = shouldPlay && !dismissed;

  useEffect(() => {
    if (!show) return;
    try {
      sessionStorage.setItem(PLAYED_KEY, "1");
    } catch {
      /* 存不上就存不上，下次再播一遍也不亏 */
    }
    document.body.style.overflow = "hidden";
    const hide = () => setDismissed(true);
    const timer = setTimeout(hide, DURATION_MS);
    window.addEventListener("keydown", hide);
    window.addEventListener("pointerdown", hide);
    return () => {
      document.body.style.overflow = "";
      clearTimeout(timer);
      window.removeEventListener("keydown", hide);
      window.removeEventListener("pointerdown", hide);
    };
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          aria-hidden
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-ink px-6 text-center"
          initial={{ y: 0 }}
          exit={{ y: "-100%" }}
          transition={{ duration: 0.5, ease: [0.7, 0, 0.2, 1] }}
        >
          <motion.p
            className="font-round text-[11px] tracking-[0.55em] text-paper/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            恋爱观察类真人秀
          </motion.p>

          <motion.h2
            className="flex items-center gap-3 font-script text-5xl leading-none text-paper sm:gap-4 sm:text-6xl"
            initial={{ opacity: 0, scale: 0.8, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.35, type: "spring", stiffness: 160, damping: 16 }}
          >
            <Sparkle weight="fill" className="size-6 shrink-0 animate-pulse text-butter sm:size-8" />
            我们的恋爱综艺
            <Sparkle weight="fill" className="size-6 shrink-0 animate-pulse text-butter sm:size-8" />
          </motion.h2>

          <motion.p
            className="font-round text-sm tracking-[0.3em] text-paper/80"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.75, duration: 0.45 }}
          >
            {season ? `第 ${season} 季 · 持续续订中` : "特别篇 · 持续续订中"}
          </motion.p>

          <motion.p
            className="font-hand text-base text-rose/90"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.15, duration: 0.45 }}
          >
            已播出 {eps} 集 · 含糖量超标，请自备胰岛素
          </motion.p>

          <motion.p
            className="absolute bottom-8 font-round text-[10px] tracking-[0.3em] text-paper/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5, duration: 0.4 }}
          >
            点击任意处跳过
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
