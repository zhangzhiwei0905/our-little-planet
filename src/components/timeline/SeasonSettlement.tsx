"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import {
  CalendarHeart,
  ChatsCircle,
  FilmSlate,
  Images,
  Scissors,
  Star,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

/** 滚到眼前再开动数字（系统开了「减少动态」就直接给终值） */
function CountUp({ to, run }: { to: number; run: boolean }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run || reduced) return;
    const controls = animate(0, to, {
      duration: 0.9,
      ease: "easeOut",
      onUpdate: (v) => setN(Math.round(v)),
    });
    return () => controls.stop();
  }, [run, to, reduced]);
  return <>{reduced ? to : n}</>;
}

/** 甜度计：半圆表盘，指针甩到头还在红区里抖——量程不足，怪不得我们 */
function SweetGauge({ run }: { run: boolean }) {
  const reduced = useReducedMotion();
  const R = 78;
  const ticks = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180];
  const pt = (angleDeg: number, r: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return [100 + r * Math.cos(rad), 100 - r * Math.sin(rad)] as const;
  };
  return (
    <div className="relative mx-auto w-full max-w-[220px]">
      <svg viewBox="0 0 200 118" className="w-full" aria-hidden>
        {/* 表盘底弧 */}
        <path d="M 22 100 A 78 78 0 0 1 178 100" fill="none" stroke="var(--color-ink)" strokeOpacity="0.25" strokeWidth="2.5" strokeLinecap="round" />
        {/* 红区：量程尽头 */}
        <path d="M 167.5 61 A 78 78 0 0 1 178 100" fill="none" stroke="var(--color-rose-deep)" strokeOpacity="0.8" strokeWidth="4" strokeLinecap="round" />
        {ticks.map((t) => {
          const [x1, y1] = pt(t, R);
          const [x2, y2] = pt(t, R - 9);
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-ink)" strokeOpacity="0.35" strokeWidth={t % 45 === 0 ? 2 : 1} strokeLinecap="round" />;
        })}
        <motion.g
          initial={{ rotate: -88 }}
          animate={run ? { rotate: reduced ? 84 : [-88, 88, 80, 85] } : { rotate: -88 }}
          transition={{ duration: 1.5, times: [0, 0.68, 0.85, 1], ease: "easeInOut" }}
          style={{ transformBox: "view-box", transformOrigin: "100px 100px" }}
        >
          <line x1="100" y1="100" x2="100" y2="36" stroke="var(--color-rose-deep)" strokeWidth="3" strokeLinecap="round" />
        </motion.g>
        <circle cx="100" cy="100" r="5.5" fill="var(--color-ink)" />
        <circle cx="100" cy="100" r="2" fill="var(--color-paper)" />
      </svg>
      <span className="absolute right-0 top-[72%] font-round text-[9px] font-bold tracking-[0.1em] text-rose-deep/80">量程不足</span>
      <p className="mt-1 text-center font-round text-[10px] tracking-[0.3em] text-ink-soft/70">综合糖分</p>
    </div>
  );
}

function StatRow({
  icon: IconC,
  label,
  note,
  children,
  delay,
  show,
}: {
  icon: Icon;
  label: string;
  note: string;
  children: React.ReactNode;
  delay: number;
  show: boolean;
}) {
  return (
    <motion.li
      className="flex items-center justify-between gap-3 border-t border-dashed border-ink/15 py-2.5"
      initial={{ opacity: 0, x: -14 }}
      animate={show ? { opacity: 1, x: 0 } : {}}
      transition={{ delay, duration: 0.45, ease: "easeOut" }}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <IconC weight="fill" className="size-4.5 shrink-0 text-rose-deep/70" />
        <span className="min-w-0">
          <span className="block font-round text-sm font-semibold text-ink">{label}</span>
          <span className="block truncate font-hand text-xs text-ink-soft">{note}</span>
        </span>
      </span>
      <span className="shrink-0 font-round text-lg font-bold leading-none text-ink">{children}</span>
    </motion.li>
  );
}

/** 本季糖分结算单：时间轴走到头，像综艺收官一样给你一张结算单。
 *  数字全是真的（大事记/语录/照片都是库里现成的），呈现是节目组定的 */
export function SeasonSettlement({
  eps,
  days,
  shots,
  quotes,
  hasStart,
}: {
  eps: number;
  days: number | null;
  shots: number;
  quotes: number;
  hasStart: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const empty = eps === 0 && shots === 0;

  return (
    <section ref={ref} aria-label="本季糖分结算单" className="relative mx-auto mt-24 w-full max-w-md px-2 sm:px-0">
      <motion.div
        className="card-paper relative px-5 py-6 sm:px-7"
        initial={{ opacity: 0, y: 26 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {/* 撕票线：剪刀压着虚线，像一张撕下来的结算单 */}
        <Scissors weight="fill" className="absolute -top-2.5 left-5 size-5 -rotate-90 text-ink/25" aria-hidden />
        <h2 className="text-center font-script text-3xl leading-tight text-rose-deep">
          {empty ? "节目待开机" : "本季糖分结算单"}
        </h2>
        <p className="mt-1 text-center font-round text-[9px] tracking-[0.32em] text-ink-soft/70">
          SWEETNESS REPORT · 全程未删减
        </p>

        {empty ? (
          <p className="mt-6 pb-2 text-center font-hand text-sm text-ink-soft">
            还没有正片，先去记一件大事，节目组马上开机。
          </p>
        ) : (
          <>
            <ul className="mt-5">
              <StatRow icon={FilmSlate} label="已播出" note="全程高能无冷场" delay={0.1} show={inView}>
                <CountUp to={eps} run={inView} /> 集
              </StatRow>
              {hasStart && days !== null && (
                <StatRow icon={CalendarHeart} label="连更天数" note="仍在持续更新" delay={0.22} show={inView}>
                  第 <CountUp to={days} run={inView} /> 天
                </StatRow>
              )}
              <StatRow icon={Images} label="名场面镜头" note="未删减放送" delay={0.34} show={inView}>
                <CountUp to={shots} run={inView} /> 个
              </StatRow>
              <StatRow icon={ChatsCircle} label="金句收录" note="已建语录馆" delay={0.46} show={inView}>
                <CountUp to={quotes} run={inView} /> 句
              </StatRow>
            </ul>

            <motion.div
              className="mt-4 border-t border-dashed border-ink/15 pt-4"
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ delay: 0.6, duration: 0.45 }}
            >
              <SweetGauge run={inView} />
            </motion.div>

            <motion.div
              className="mt-3 flex items-center justify-between gap-3 border-t border-dashed border-ink/15 pt-3"
              initial={{ opacity: 0, x: -14 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ delay: 0.78, duration: 0.45 }}
            >
              <span className="flex items-center gap-2.5">
                <Star weight="fill" className="size-4.5 shrink-0 text-butter" />
                <span>
                  <span className="block font-round text-sm font-semibold text-ink">观察员评分</span>
                  <span className="block font-hand text-xs text-ink-soft">不允许打更低</span>
                </span>
              </span>
              <span className="font-round text-lg font-bold leading-none text-ink">10.0 / 10</span>
            </motion.div>
          </>
        )}

        {/* 大红章：盖在结算单右下角，压着边才像真的 */}
        {!empty && (
          <motion.span
            className="stamp-circle absolute -bottom-5 -right-3 sm:-right-5"
            initial={{ opacity: 0, scale: 1.6, rotate: 14 }}
            animate={inView ? { opacity: 1, scale: 1, rotate: -5 } : {}}
            transition={{ delay: 1.15, type: "spring", stiffness: 260, damping: 15 }}
            aria-hidden
          >
            <span className="font-script text-3xl leading-none">甜</span>
            <span className="mt-1 font-round text-[9px] leading-none tracking-[0.25em] opacity-70">已盖章</span>
          </motion.span>
        )}

        <p className={cn("mt-5 text-center font-hand text-sm text-ink-soft", empty ? "sr-only" : "")}>
          下一季 · 已续订 —— 由「憧憬」栏目组联合出品
        </p>
      </motion.div>
    </section>
  );
}
