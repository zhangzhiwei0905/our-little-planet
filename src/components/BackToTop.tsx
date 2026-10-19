"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp } from "@phosphor-icons/react";

/** 每个页面右下角的「回到最上方」：往下滚过一屏才出现，点了平滑回顶。
 *  用页面顶部的一根哨兵 + IntersectionObserver 判断「已经滚下去了」，
 *  不挂 scroll 监听（几百张图的墙滚动时监听会跟着抖） */
export function BackToTop() {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setShow(!entry.isIntersecting), {
      rootMargin: "200px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="absolute top-0 h-px w-px" />
      <AnimatePresence>
        {show && (
          <motion.button
            key="back-to-top"
            type="button"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            onClick={() => window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })}
            aria-label="回到最上方"
            title="回到最上方"
            className="fixed bottom-5 right-5 z-40 grid size-10 place-items-center rounded-full border border-ink/10 bg-paper/90 text-ink shadow-card backdrop-blur transition-transform duration-300 ease-spring hover:-translate-y-1 hover:text-rose-deep"
          >
            <ArrowUp weight="bold" className="size-4.5" />
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}
