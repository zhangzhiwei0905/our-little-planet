"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Confetti, FilmSlate, Play, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { Screening } from "@/lib/screenings";
import { pickOf, tiltOf, TAPE_TONES } from "@/lib/tilt";
import { WashiTape } from "@/components/journal/WashiTape";
import { SeenStamp } from "@/components/marks/SeenStamp";
import { CommentBox } from "@/components/marks/CommentBox";

function fmtDur(sec: number | null): string {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function today(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** 放映画幅：横屏铺满（16:9 兜底），竖屏竖着放（高度撑到约七成视口、宽度按比例） */
function VideoStage({
  video,
}: {
  video: Screening["video"];
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const w = video.width ?? natural?.w ?? null;
  const h = video.height ?? natural?.h ?? null;
  const portrait = w !== null && h !== null && h > w;
  return (
    /* eslint-disable-next-line jsx-a11y/media-has-caption -- 纪念成片没有字幕轨 */
    <video
      key={video.id}
      src={video.url}
      poster={video.posterUrl ?? undefined}
      controls
      playsInline
      preload="metadata"
      onLoadedMetadata={(e) => setNatural({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
      className={cn("block", portrait ? "mx-auto max-h-[68vh] w-auto max-w-full" : "aspect-video w-full")}
      style={portrait && w && h ? { aspectRatio: `${w} / ${h}` } : undefined}
    />
  );
}

/** 海报墙 + 影院浮层：点开海报进「放映」，暗场里放完整成片，
 *  映后有已阅印章和观后感（和她其他痕迹一处收） */
export function ScreeningWall({
  screenings,
  author,
  reader,
}: {
  screenings: Screening[];
  author: boolean;
  reader: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = screenings.find((s) => s.id === openId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const t = today();
  // 场次编号按时间正序：最老的一场是「第 1 场」
  const ordered = [...screenings].reverse();

  return (
    <>
      <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-8 pt-4 sm:grid-cols-3 sm:gap-10">
        {screenings.map((s) => {
          const no = ordered.findIndex((x) => x.id === s.id) + 1;
          const premiered = s.premiereAt <= t;
          const days = premiered
            ? 0
            : Math.max(
                1,
                Math.round(
                  (new Date(`${s.premiereAt}T00:00:00`).getTime() - new Date(`${t}T00:00:00`).getTime()) / 86_400_000
                )
              );
          const playable = premiered || author;
          return (
            <button
              key={s.id}
              type="button"
              disabled={!playable}
              onClick={() => playable && setOpenId(s.id)}
              className={cn(
                "group relative block text-left transition-transform duration-500 ease-spring",
                playable ? "cursor-pointer hover:[transform:rotate(0deg)_translateY(-8px)]" : "cursor-default"
              )}
              style={{ transform: `rotate(${tiltOf(s.id, 2)}deg)` }}
              aria-label={`${premiered ? "观看" : author ? "预览" : "未首映"}：${s.title}`}
            >
              <div className="relative overflow-hidden rounded-xl bg-paper-deep shadow-card transition-shadow group-hover:shadow-lifted">
                <div className="relative aspect-[2/3] w-full">
                  {s.coverUrl || s.video.posterUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- 封面走带鉴权的 /api/media */
                    <img
                      src={(s.coverUrl ?? s.video.posterUrl)!}
                      alt={`${s.title} 的海报`}
                      loading="lazy"
                      className={cn("h-full w-full object-cover", !premiered && "opacity-60 saturate-50")}
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-ink/15 to-rose-soft/40 text-ink-soft">
                      <FilmSlate weight="fill" className="size-10 opacity-70" />
                      <span className="font-script text-xl">no poster</span>
                    </div>
                  )}
                  {/* 海报底部的片名压条 */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pb-3 pt-10">
                    <p className="truncate font-script text-2xl leading-tight text-white/95">{s.title}</p>
                    {s.subtitle && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-white/70">{s.subtitle}</p>}
                  </div>
                  {/* 已首映：场次章 */}
                  {premiered && (
                    <span className="stamp-blend absolute right-2.5 top-2.5 inline-flex rotate-6 flex-col items-center rounded-full border-2 border-rose-deep/70 px-2 py-1 font-round text-[9px] font-bold leading-tight tracking-widest text-rose-deep/90"
                      style={{ background: "color-mix(in srgb, var(--color-rose-deep) 8%, transparent)" }}>
                      第 {no} 场
                      <span className="text-[8px] opacity-80">{s.premiereAt.replaceAll(".", "-").replaceAll("-", ".")}</span>
                    </span>
                  )}
                  {/* 未首映：幕布封条 + 倒计时 */}
                  {!premiered && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/55 backdrop-blur-[2px]">
                      <Confetti weight="fill" className="size-7 text-butter" />
                      <p className="font-round text-sm font-bold tracking-widest text-paper">尚未首映</p>
                      <p className="font-script text-2xl text-butter">还有 {days} 天</p>
                      <p className="font-round text-[10px] tracking-wider text-paper/60">{s.premiereAt.replaceAll("-", ".")} 开演</p>
                    </div>
                  )}
                  {/* 播放角标 */}
                  {playable && (
                    <span className="absolute left-2.5 top-2.5 grid size-9 place-items-center rounded-full bg-ink/45 text-paper backdrop-blur transition group-hover:bg-rose-deep/85">
                      <Play weight="fill" className="size-4 translate-x-px" />
                    </span>
                  )}
                </div>
              </div>
              <WashiTape tone={pickOf(s.id, TAPE_TONES)} rotate={tiltOf(s.id, 2) > 0 ? -6 : 5} className="-top-3 left-1/2 scale-90" />
              <p className="mt-2.5 text-center font-round text-[11px] tracking-wider text-ink-soft">
                {fmtDur(s.video.duration) && `${fmtDur(s.video.duration)} · `}
                {premiered ? `首映于 ${s.premiereAt.replaceAll("-", ".")}` : "等一个日子"}
              </p>
            </button>
          );
        })}
      </div>

      {/* 影院浮层：暗场放映 */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="screening-overlay"
            className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/85 p-4 backdrop-blur-sm sm:p-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => setOpenId(null)}
          >
            <motion.div
              key={open.id}
              className="relative my-auto w-full max-w-3xl rounded-2xl bg-paper px-4 py-6 shadow-lifted sm:px-8 sm:py-8"
              initial={{ y: 40, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 24, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label="散场"
                onClick={() => setOpenId(null)}
                className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full text-ink-soft/70 transition hover:bg-ink/10 hover:text-ink"
              >
                <X weight="bold" className="size-4" />
              </button>

              <header className="mb-5 text-center">
                <p className="font-round text-xs font-bold tracking-[0.3em] text-ink-soft/70">NOW SHOWING</p>
                <h2 className="mt-2 font-script text-4xl leading-tight text-rose-deep">{open.title}</h2>
                {open.subtitle && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{open.subtitle}</p>}
                <p className="mt-2 font-round text-xs tracking-widest text-ink-soft/60">
                  首映 {open.premiereAt.replaceAll("-", ".")}
                  {fmtDur(open.video.duration) && ` · ${fmtDur(open.video.duration)}`}
                </p>
              </header>

              <div className="overflow-hidden rounded-xl bg-black shadow-lifted">
                {/* 画幅跟着视频走：横屏用电影画幅铺满；竖屏（高>宽）以高度为约束居中，
                    不硬塞 16:9 的框——尺寸元数据缺失时再由 onLoadedMetadata 兜底测量 */}
                <VideoStage video={open.video} />
              </div>
              {open.video.hevc && (
                <p className="mt-2 text-center font-round text-[11px] tracking-wider text-ink-soft/60">
                  这段是 HEVC 编码：iPhone / Safari 没问题，电脑 Chrome 可能放不了
                </p>
              )}

              {reader && (
                <div className="mt-6">
                  <div className="mb-4 flex items-center justify-between gap-4 px-1">
                    <p className="font-script text-2xl text-rose-deep">映后</p>
                    <SeenStamp entryId={open.id} seenAt={null} />
                  </div>
                  <CommentBox
                    entryId={open.id}
                    heading="写一句观后感"
                    placeholder="看完这一场，想说点什么…"
                  />
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
