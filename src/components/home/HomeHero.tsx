"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { pickOf, tiltOf, NOTE_TONES, TAPE_TONES } from "@/lib/tilt";
import type { AlbumPhoto } from "@/lib/entries";
import { FlipPolaroid } from "@/components/home/FlipPolaroid";
import { StickyNote } from "@/components/journal/StickyNote";
import { Sticker } from "@/components/journal/Sticker";
import { Lightbox } from "@/components/album/Lightbox";

export type HeroQuote = { id: string; body: string; speaker: string | null };

/** 随机换到「另一张/另一句」：池子只有 1 个时保持不动 */
function randOther(cur: number, len: number): number {
  if (len < 2) return cur;
  const next = Math.floor(Math.random() * (len - 1));
  return next >= cur ? next + 1 : next;
}

/** 首页的大拍立得 + 便利贴语录：服务端把池子随机打乱好传进来，
 *  这里每 5 秒再随机换一张/换一句（不重复当前这张）；点照片开灯箱放大看，
 *  灯箱开着、手指悬停着、标签页切走时暂停轮换——她还没读完就不许翻走；
 *  点便利贴可以手动「再听一句」 */
export function HomeHero({ photos, quotes, author = false }: { photos: AlbumPhoto[]; quotes: HeroQuote[]; author?: boolean }) {
  // 灯箱里改过的描述回填这份本地状态，大拍立得跟着换字（不打扰服务端的随机翻牌顺序）
  const [pool, setPool] = useState(photos);
  const [idx, setIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  // 翻着拍立得背面看字的时候也不许轮换走
  const [flipped, setFlipped] = useState(false);

  const onCaption = useCallback((id: string, caption: string | null) => {
    setPool((prev) => prev.map((p) => (p.id === id ? { ...p, caption } : p)));
  }, []);

  useEffect(() => {
    if (zoom !== null || paused || flipped || (pool.length < 2 && quotes.length < 2)) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      setIdx((i) => randOther(i, pool.length));
      setQIdx((i) => randOther(i, quotes.length));
    }, 5000);
    return () => clearInterval(timer);
  }, [zoom, paused, flipped, pool.length, quotes.length]);

  const nextQuote = useCallback(() => {
    setQIdx((i) => randOther(i, quotes.length));
  }, [quotes.length]);

  const photo = pool[idx];
  const quote = quotes[qIdx];

  return (
    <div
      className="relative mx-auto w-full max-w-sm pb-10 lg:max-w-md"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {photo && (
          <motion.div
            key={photo.id}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.97 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* 点一下翻到背面：手写的一句话 + 日期章；背面有「放大看」进灯箱 */}
            <FlipPolaroid
              src={photo.thumbUrl ?? photo.url}
              caption={photo.caption}
              note={photo.note}
              date={photo.entryDate}
              alt={photo.caption ?? "随机翻到的一张拍立得"}
              tilt={tiltOf(photo.id, 3)}
              tone={pickOf(photo.id, TAPE_TONES)}
              liveVideo={photo.liveVideo}
              onZoom={() => setZoom(idx)}
              onFlipChange={setFlipped}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <Sticker name="heart" className="absolute -right-3 top-6 size-9 rotate-12 text-rose/80" />
      <Sticker name="star" className="absolute -left-5 top-1/3 size-7 -rotate-12 text-butter" />
      <Sticker name="flower" className="absolute -bottom-2 right-8 size-10 rotate-6 text-matcha" />
      <AnimatePresence initial={false}>
        {quote && (
          <motion.div
            key={quote.id}
            role="button"
            tabIndex={0}
            aria-label="再听一句"
            title="再听一句"
            initial={{ opacity: 0, rotate: 8, y: 10 }}
            animate={{ opacity: 1, rotate: 0, y: 0 }}
            exit={{ opacity: 0, rotate: -6, y: 8 }}
            transition={{ duration: 0.4 }}
            className="absolute -bottom-8 -left-4 w-48 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-rose/60 focus-visible:ring-offset-4 sm:-left-12"
            onClick={nextQuote}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                nextQuote();
              }
            }}
          >
            <StickyNote
              text={quote.body.length > 42 ? quote.body.slice(0, 42) + "…" : quote.body}
              speaker={quote.speaker}
              tilt={3}
              tone={pickOf(quote.id, NOTE_TONES)}
            >
              {quotes.length > 1 && (
                <p className="mt-2 flex items-center gap-1 font-round text-[11px] font-bold tracking-wider text-ink/45">
                  <ArrowClockwise weight="bold" className="size-3" />
                  再听一句
                </p>
              )}
            </StickyNote>
          </motion.div>
        )}
      </AnimatePresence>
      <Lightbox
        photos={pool}
        index={zoom}
        onClose={() => setZoom(null)}
        onNav={(next) => setZoom(next)}
        canEdit={author}
        onCaptionChange={onCaption}
      />
    </div>
  );
}
