"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";

/** 横滑照片墙的外框：右端渐变淡出 + 圆形小箭头——告诉读者「后面还有，能滑」。
 *  滑到底箭头和渐变自动收起；桌面端点箭头等于用手往左拨一把 */
export function SnapRail({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
    check();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  return (
    <div className="relative">
      <div ref={ref} className="-mx-4 flex snap-x gap-7 overflow-x-auto px-4 pb-10 pt-4 no-scrollbar sm:-mx-6 sm:px-6">
        {children}
      </div>
      {!atEnd && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-paper via-paper/70 to-transparent" />
          <button
            type="button"
            aria-label="往右再翻翻"
            onClick={() => ref.current?.scrollBy({ left: 320, behavior: "smooth" })}
            className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-ink/10 bg-paper/95 text-ink-soft shadow-card transition hover:-translate-y-[55%] hover:text-ink sm:right-2"
          >
            <ArrowRight weight="bold" className="size-5" />
          </button>
        </>
      )}
    </div>
  );
}
