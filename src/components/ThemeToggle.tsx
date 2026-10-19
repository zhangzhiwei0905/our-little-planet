"use client";

import { useEffect, useState } from "react";
import { MoonStars, Sun } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

export const THEME_KEY = "journal-theme";

/** 明暗模式切换：月亮/太阳换装，点一下切换 <html> 上的 .dark。
 *  偏好存 localStorage；没存过就跟系统走（首帧由 layout 里的内联脚本定好，不闪） */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* 私密模式存不了也不影响切换 */
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "切换到白天模式" : "切换到夜间模式"}
      title={dark ? "切换到白天模式" : "切换到夜间模式"}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink",
        className
      )}
    >
      {dark === null ? (
        <Sun weight="fill" className="size-4 opacity-0" />
      ) : dark ? (
        <MoonStars weight="fill" className="size-4 text-butter" />
      ) : (
        <Sun weight="fill" className="size-4 text-peach" />
      )}
    </button>
  );
}
