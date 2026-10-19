"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Pause, Play, TextAa, X } from "@phosphor-icons/react";
import { parseLrc } from "@/lib/lrc";
import { NOTE_COLORS } from "@/lib/tilt";
import { WashiTape } from "@/components/journal/WashiTape";
import { cn } from "@/lib/cn";

/** 大事记的背景音乐：右下角一张会转的小唱片 + 可抽出的歌词信纸卡。
 *  视频联动：页面里任何 <video> 开口（内联的、灯箱 portal 的都算）音乐先让路，
 *  等最后一个视频停下再从原进度接上；她亲手按停的音乐不会被强行复活。
 *  会话内记住选择：本页签里开过，切走再回来接着放。 */

const SESSION_KEY = "bgm-wanted";

function fmt(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return "0:00";
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

export function BgmPlayer({ src, title, lyrics }: { src: string; title: string; lyrics: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lyricsBoxRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  /** 因视频让路暂停的标记；userPaused = 她亲手停的，视频结束后不替她复活 */
  const pausedForVideo = useRef(false);
  const userPaused = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const reduce = useReducedMotion();
  const lrc = useMemo(() => parseLrc(lyrics), [lyrics]);

  // 当前唱到第几行：二分找最后一个时间 <= 当前进度的行
  const activeLine = useMemo(() => {
    if (!lrc.synced || lrc.lines.length === 0) return -1;
    let lo = 0;
    let hi = lrc.lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((lrc.lines[mid].time ?? 0) <= cur) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }, [lrc, cur]);

  useEffect(() => {
    const a = new Audio();
    a.src = src;
    a.loop = true;
    a.preload = "metadata";
    a.volume = 0.75;
    a.addEventListener("play", () => setPlaying(true));
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("loadedmetadata", () => setDur(Number.isFinite(a.duration) ? a.duration : 0));
    a.addEventListener("timeupdate", () => setCur(a.currentTime));
    audioRef.current = a;
    // 这个页签里她开过音乐：回到这页接着放（文档早就激活过，一般不会被自动播放策略拦）
    if (sessionStorage.getItem(SESSION_KEY) === "1") void a.play().catch(() => undefined);
    return () => {
      a.pause();
      audioRef.current = null;
    };
  }, [src]);

  // 当前行滚到歌词卡中间
  useEffect(() => {
    if (!open) return;
    const box = lyricsBoxRef.current;
    const el = activeLine >= 0 ? lineRefs.current[activeLine] : null;
    if (!box) return;
    if (!el) {
      box.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: reduce ? "auto" : "smooth" });
  }, [activeLine, open, reduce]);

  // 视频哨兵：媒体事件不冒泡，捕获阶段在 document 上统一监听，
  // 内联视频和灯箱（portal 挂 body）里的视频一处不漏
  useEffect(() => {
    function anyVideoPlaying(): boolean {
      return Array.from(document.querySelectorAll("video")).some((v) => !v.paused && !v.ended);
    }
    function onVideoStart(e: Event) {
      if (!(e.target instanceof HTMLVideoElement)) return;
      const a = audioRef.current;
      if (a && !a.paused) {
        a.pause();
        pausedForVideo.current = true;
      }
    }
    function onVideoStop() {
      if (!pausedForVideo.current) return;
      if (anyVideoPlaying()) return;
      pausedForVideo.current = false;
      const a = audioRef.current;
      if (a && userPaused.current) return;
      void a?.play().catch(() => undefined);
    }
    document.addEventListener("play", onVideoStart, true);
    document.addEventListener("pause", onVideoStop, true);
    document.addEventListener("ended", onVideoStop, true);
    return () => {
      document.removeEventListener("play", onVideoStart, true);
      document.removeEventListener("pause", onVideoStop, true);
      document.removeEventListener("ended", onVideoStop, true);
    };
  }, []);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      userPaused.current = false;
      pausedForVideo.current = false;
      sessionStorage.setItem(SESSION_KEY, "1");
      void a.play().catch(() => undefined);
    } else {
      userPaused.current = true;
      sessionStorage.setItem(SESSION_KEY, "0");
      a.pause();
    }
  }

  function seekTo(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * dur;
    setCur(ratio * dur);
  }

  const hasLyrics = lrc.lines.length > 0;
  const pct = dur ? (cur / dur) * 100 : 0;

  return (
    // 右下角往左让一格：最角落留给全站的「回到顶部」按钮，避免叠在一起
    <div className="fixed bottom-5 right-[4.25rem] z-40 flex flex-col items-end gap-3">
      <AnimatePresence>
        {open && hasLyrics && (
          <motion.div
            key="bgm-lyrics"
            initial={{ opacity: 0, y: 24, rotate: 2 }}
            animate={{ opacity: 1, y: 0, rotate: -2 }}
            exit={{ opacity: 0, y: 24, rotate: 2 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="sticky-note w-[18rem] max-w-[calc(100vw-2.5rem)] px-5 pt-6 pb-5"
            style={{ "--tone": NOTE_COLORS["rose-soft"], transform: "rotate(-2deg)" } as React.CSSProperties}
          >
            <WashiTape tone="rose" rotate={3} className="-top-2.5 left-1/2 scale-75" />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="收起歌词"
              className="absolute right-2 top-2 grid size-7 place-items-center rounded-full text-ink/50 transition hover:bg-ink/10 hover:text-ink"
            >
              <X weight="bold" className="size-4" />
            </button>
            <p className="pr-8 font-script text-2xl leading-tight text-rose-deep">{title}</p>

            <div className="mt-3">
              <div className="h-1.5 cursor-pointer rounded-full bg-ink/10" onClick={seekTo} role="presentation">
                <div className="h-full rounded-full bg-rose transition-[width] duration-300" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 flex justify-between font-round text-[10px] font-bold tracking-wider text-ink/50">
                <span>{fmt(cur)}</span>
                <span>{dur ? fmt(dur) : "--:--"}</span>
              </p>
            </div>

            <div
              ref={lyricsBoxRef}
              className="mt-2 max-h-60 overflow-y-auto py-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(180deg,transparent,#000_18%,#000_82%,transparent)]"
            >
              {lrc.synced ? (
                lrc.lines.map((line, i) => (
                  <p
                    key={i}
                    ref={(el) => {
                      lineRefs.current[i] = el;
                    }}
                    className={cn(
                      "px-1 py-1.5 text-center leading-relaxed transition-colors duration-300",
                      i === activeLine ? "text-base font-bold text-rose-deep" : i < activeLine ? "text-sm text-ink/35" : "text-sm text-ink/60"
                    )}
                  >
                    {line.text}
                  </p>
                ))
              ) : (
                <div className="whitespace-pre-line px-1 py-1 text-sm leading-relaxed text-ink/70">{lyrics}</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2.5">
        {hasLyrics && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "收起歌词" : "看歌词"}
            aria-expanded={open}
            className="grid size-9 place-items-center rounded-full bg-paper/90 text-ink shadow-card backdrop-blur transition-transform duration-300 ease-spring hover:-translate-y-0.5"
          >
            <TextAa weight="bold" className="size-4.5" />
          </button>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "暂停背景音乐" : "播放背景音乐"}
          className="relative grid size-14 place-items-center overflow-hidden rounded-full bg-ink shadow-lifted transition-transform duration-300 ease-spring hover:-translate-y-1 active:scale-95"
        >
          {/* 唱片纹路 + 唱面上一点反光：转起来就是它在转（动画在 globals.css，尊重「减少动态」） */}
          <span
            aria-hidden
            className={cn(
              "absolute inset-0 rounded-full [background:repeating-radial-gradient(circle_at_center,rgba(255,249,240,0.1)_0_1px,transparent_1px_3px)]",
              playing && "bgm-disc-spin"
            )}
          >
            <span className="absolute left-[24%] top-[13%] size-1.5 rounded-full bg-paper/60" />
          </span>
          <span className="relative grid size-7 place-items-center rounded-full bg-rose-deep text-paper shadow-sm">
            {playing ? <Pause weight="fill" className="size-3.5" /> : <Play weight="fill" className="size-3.5 translate-x-px" />}
          </span>
        </button>
      </div>
    </div>
  );
}
