"use client";

import { motion, useReducedMotion } from "motion/react";

/** 首页大标题：手绘下划线在进来时「画」出来（原来 .scribble 是静态贴图），
 *  配合解锁后的第一眼，多一点仪式感；「减少动态」直接画好 */
export function ScribbleTitle({ title }: { title: string }) {
  const reduce = useReducedMotion();
  return (
    <h1 className="relative mt-4 inline-block pb-3 text-5xl font-bold leading-tight sm:text-6xl">
      {title}
      <svg
        aria-hidden
        viewBox="0 0 300 12"
        preserveAspectRatio="none"
        className="absolute -bottom-1 left-[-2%] h-[10px] w-[104%]"
      >
        <motion.path
          d="M4 8 Q 80 2 150 7 T 296 5"
          fill="none"
          stroke="var(--color-rose)"
          strokeWidth="5"
          strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, delay: 0.45, ease: "easeOut" }}
        />
      </svg>
    </h1>
  );
}
