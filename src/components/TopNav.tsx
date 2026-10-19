"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ChatTeardropText,
  EnvelopeSimple,
  FilmSlate,
  Heart,
  HouseSimple,
  Images,
  Lock,
  Notebook,
  Path,
  PencilSimple,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { SectionKey } from "@/lib/settings";
import { ThemeToggle } from "@/components/ThemeToggle";
import { READER_NAME } from "@/lib/reader";

const TABS = [
  { href: "/", section: "home" as SectionKey, label: "首页", icon: HouseSimple, active: "bg-butter text-ink" },
  { href: "/journal", section: "journal" as SectionKey, label: "手账", icon: Notebook, active: "bg-matcha text-ink" },
  { href: "/album", section: "album" as SectionKey, label: "相册", icon: Images, active: "bg-mist text-ink" },
  { href: "/quotes", section: "quotes" as SectionKey, label: "语录", icon: ChatTeardropText, active: "bg-peach text-ink" },
  { href: "/letters", section: "letters" as SectionKey, label: "信箱", icon: EnvelopeSimple, active: "bg-rose-soft text-rose-deep" },
  { href: "/timeline", section: "timeline" as SectionKey, label: "大事记", icon: Path, active: "bg-butter text-ink" },
  { href: "/screenings", section: "screenings" as SectionKey, label: "放映室", icon: FilmSlate, active: "bg-ink/10 text-ink" },
] as const;

type HeartDrop = { x: number; size: number; dur: number; delay: number; drift: number; rot: number };

/** 手账侧边的彩色索引贴导航。
 *  访客（没输过密码）只看得到设为「公开」的栏目；没公开的栏目直接不出现，
 *  右端给访客留一枚小锁进「她的专属」。
 *  藏了一个彩蛋：2.5 秒内连点 5 下左上角的小爱心，会下一小阵爱心雨（20 秒内只灵一次） */
export function TopNav({
  title,
  author,
  reader = false,
  sections,
}: {
  title: string;
  author: boolean;
  /** 她本人（读者或作者）＝看得到全部栏目 */
  reader?: boolean;
  /** 各栏目对访客是否公开（读者登录后忽略） */
  sections?: Partial<Record<SectionKey, boolean>>;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const reduce = useReducedMotion();
  const [rain, setRain] = useState<{ id: number; drops: HeartDrop[] } | null>(null);
  const taps = useRef<number[]>([]);
  const cooldownUntil = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onLogoTap() {
    const now = Date.now();
    taps.current = taps.current.filter((t) => now - t < 2500);
    taps.current.push(now);
    if (taps.current.length < 5 || now < cooldownUntil.current || reduce) return;
    taps.current = [];
    cooldownUntil.current = now + 20_000;
    const drops: HeartDrop[] = Array.from({ length: 26 }, () => ({
      x: 2 + Math.random() * 96,
      size: 14 + Math.random() * 16,
      dur: 2.4 + Math.random() * 1.4,
      delay: Math.random() * 0.9,
      drift: (Math.random() - 0.5) * 80,
      rot: (Math.random() - 0.5) * 50,
    }));
    setRain({ id: now, drops });
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setRain(null), 4500);
  }

  // 访客只看公开栏目；读者（她/作者）全看
  const visibleTabs = reader ? TABS : TABS.filter((t) => sections?.[t.section] === true);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/85 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <Link href="/" aria-label={title} onClick={onLogoTap} className="flex shrink-0 items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-rose-soft text-rose-deep">
            <Heart weight="fill" className="size-4" />
          </span>
          {/* 手机端只留爱心图标，把空间让给导航标签 */}
          <span className="hidden text-lg font-bold md:inline">{title}</span>
        </Link>
        {/* 页签全放在顶栏（桌面/移动端同一排）。右端一道渐隐边：页签放不下时告诉读者「还能滑」 */}
        <div className="relative min-w-0 flex-1">
          <div className="no-scrollbar flex items-center gap-1 overflow-x-auto sm:gap-1.5">
            {visibleTabs.map(({ href, label, icon: Icon, active }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-bold transition-all duration-300 ease-spring sm:px-3.5 sm:text-sm",
                  isActive(href)
                    ? cn(active, "-translate-y-px shadow-sm")
                    : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                )}
              >
                <Icon weight="fill" className="size-4 shrink-0" />
                {label}
              </Link>
            ))}
            {author && (
              <Link
                href="/write"
                className={cn(
                  "ml-0.5 flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-bold transition-all duration-300 ease-spring sm:px-3.5 sm:text-sm",
                  isActive("/write")
                    ? "-translate-y-px bg-rose-deep text-paper shadow-md"
                    : "bg-rose-soft text-rose-deep hover:-translate-y-px"
                )}
              >
                <PencilSimple weight="bold" className="size-4 shrink-0" />
                记一笔
              </Link>
            )}
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper to-transparent" />
        </div>
        {/* 右端常驻：明暗切换 + 访客的「她的专属」小锁 */}
        <div className="flex shrink-0 items-center gap-0.5">
          <ThemeToggle />
          {!reader && (
            <Link
              href="/lock"
              aria-label={`${READER_NAME}的专属入口`}
              title={`${READER_NAME}的专属：输密码进来`}
              className="grid size-8 place-items-center rounded-full text-rose-deep/70 transition hover:bg-rose-soft/60 hover:text-rose-deep"
            >
              <Lock weight="fill" className="size-4" />
            </Link>
          )}
        </div>
      </nav>
      </header>

      {/* 爱心雨：纯装饰，不挡点按。必须挂在 header 外面——header 的 backdrop-blur
          会把 fixed 定位的包含块吃掉，雨就只会下在导航条里而不是全屏 */}
      <AnimatePresence>
        {rain && (
          <div aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
            {rain.drops.map((d, i) => (
              <motion.span
                key={`${rain.id}-${i}`}
                className="absolute top-0 text-rose"
                style={{ left: `${d.x}%` }}
                initial={{ y: "-8vh", opacity: 0, rotate: d.rot }}
                animate={{ y: "112vh", opacity: [0, 1, 1], rotate: d.rot * 2, x: d.drift }}
                exit={{ opacity: 0 }}
                transition={{ duration: d.dur, delay: d.delay, ease: "easeIn" }}
              >
                <Heart weight="fill" style={{ width: d.size, height: d.size }} />
              </motion.span>
            ))}
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
