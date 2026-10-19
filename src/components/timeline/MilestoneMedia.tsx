"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { CaretLeft, CaretRight, Play } from "@phosphor-icons/react";
import type { PublicMedia } from "@/lib/entries";
import { tiltOf } from "@/lib/tilt";
import { PolaroidCard } from "@/components/journal/PolaroidCard";
import { Lightbox } from "@/components/album/Lightbox";
import { cn } from "@/lib/cn";
import { useMounted } from "@/lib/use-mounted";

/** 大事记里的照片/视频：多个时做成可左右切换的小车，
 *  照片点开进灯箱放大（实况照片可回放），视频当场就能播。
 *  灯箱用 portal 挂到 body：卡片 hover 有位移动画（transform），
 *  fixed 的全屏层放在卡片里面会被 transform 祖先困住、跟着卡片闪 */
export function MilestoneMedia({
  media,
  entryDate,
  tone,
  author = false,
}: {
  media: PublicMedia[];
  entryDate: string;
  tone: string;
  author?: boolean;
}) {
  // 灯箱里改过的描述回填这份本地状态，小车里的拍立得/视频下的字跟着换
  const [items, setItems] = useState(media);
  const onCaption = useCallback((id: string, caption: string | null) => {
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, caption } : m)));
  }, []);
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null);
  // portal 只能在浏览器挂（服务端渲染没有 document）：水合完成前固定 false
  const mounted = useMounted();
  const touchX = useRef<number | null>(null);
  const touchY = useRef<number | null>(null);
  const warmed = useRef(new Set<string>());
  const videoHostRef = useRef<HTMLDivElement>(null);
  const [videoReadyId, setVideoReadyId] = useState<string | null>(null);

  const count = items.length;
  const carousel = count > 1;
  const m = items[Math.min(idx, count - 1)];
  const currentMediaId = m?.id;
  const currentMediaKind = m?.kind;

  useEffect(() => {
    if (!currentMediaId || currentMediaKind !== "video") return;
    const el = videoHostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVideoReadyId(currentMediaId);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVideoReadyId(currentMediaId);
          io.disconnect();
        }
      },
      { rootMargin: "700px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [currentMediaId, currentMediaKind]);

  const warmMedia = useCallback((item: PublicMedia) => {
    const src = item.kind === "video" ? item.posterUrl : item.thumbUrl ?? item.url;
    if (!src || warmed.current.has(src) || typeof Image === "undefined") return;
    warmed.current.add(src);
    const image = new Image();
    image.decoding = "async";
    image.src = src;
  }, []);

  const warmNeighbors = useCallback(() => {
    if (count < 2) return;
    warmMedia(items[(idx + count - 1) % count]);
    warmMedia(items[(idx + 1) % count]);
  }, [count, idx, items, warmMedia]);

  if (!m) return null;

  const go = (next: number) => {
    setDir(next > idx ? 1 : -1);
    setIdx((next + count) % count);
  };

  const lightboxPhotos = items.map((x) => ({
    id: x.id,
    url: x.url,
    caption: x.caption,
    entryDate,
    width: x.width,
    height: x.height,
    kind: x.kind === "video" ? ("video" as const) : ("photo" as const),
    hevc: x.hevc,
    liveVideo: x.liveVideo,
    posterUrl: x.posterUrl,
  }));

  return (
    <div className="relative mt-4">
      {/* 滑动区：方向感的横移 + 淡入淡出；切走时视频随卸载自动停 */}
      <div
        className={cn("relative overflow-hidden", carousel && "aspect-[3/4] w-full")}
        onPointerEnter={warmNeighbors}
        onFocus={warmNeighbors}
        onTouchStart={(e) => {
          warmNeighbors();
          touchX.current = e.touches[0].clientX;
          touchY.current = e.touches[0].clientY;
        }}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          const dy = e.changedTouches[0].clientY - (touchY.current ?? 0);
          touchX.current = null;
          touchY.current = null;
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? idx + 1 : idx - 1);
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={m.id}
            className={carousel ? "absolute inset-0 p-2" : undefined}
            initial={{ opacity: 0, x: 36 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -36 * dir }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {m.kind === "video" ? (
              <div
                ref={videoHostRef}
                className={cn("relative overflow-hidden rounded-xl border border-ink/10 bg-ink/5 shadow-card", carousel && "flex h-full min-h-0 flex-col")}
              >
                {/* 不用 <source type>：Chrome 对 video/quicktime 报「不支持」会整个跳过这个 source，
                    iPhone 拍的 .mov 就永远加载不出来（metadata 都不拉，更别说播）；src 直挂让浏览器自己嗅探 */}
                <video
                  src={videoReadyId === m.id ? m.url : undefined}
                  controls
                  playsInline
                  preload={videoReadyId === m.id ? "metadata" : "none"}
                  poster={m.posterUrl ?? undefined}
                  className={carousel ? "min-h-0 w-full flex-1 object-contain" : "w-full"}
                />
                {(m.caption || carousel) && (
                  <div className={cn("px-3 py-2 font-script text-xl text-ink/90", carousel && "h-[4.375rem] shrink-0 overflow-hidden")}>
                    <p className={carousel ? "line-clamp-2 break-words" : undefined}>{m.caption}</p>
                  </div>
                )}
                <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-ink/55 px-2 py-0.5 text-[10px] font-bold text-paper backdrop-blur">
                  <Play weight="fill" className="size-2.5" />
                  视频
                </span>
              </div>
            ) : (
              <button type="button" onClick={() => setZoom(idx)} className={cn("block w-full cursor-zoom-in", carousel && "h-full min-h-0")} aria-label={m.caption ?? "放大看这张照片"}>
                <PolaroidCard
                  src={m.thumbUrl ?? m.url}
                  fallbackSrc={m.url}
                  caption={m.caption}
                  alt={m.caption ?? "我们的照片"}
                  tilt={carousel ? 0 : tiltOf(m.id, 2)}
                  tone={tone as never}
                  tape="none"
                  width={m.width}
                  height={m.height}
                  liveVideo={m.liveVideo}
                  fixedFrame={carousel}
                />
              </button>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 左右切换 + 页码：只有一个时不需要 */}
      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="上一个"
            onClick={() => go(idx - 1)}
            className="absolute -left-1 top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-paper/85 text-ink shadow-card backdrop-blur transition hover:bg-paper"
          >
            <CaretLeft weight="bold" className="size-5" />
          </button>
          <button
            type="button"
            aria-label="下一个"
            onClick={() => go(idx + 1)}
            className="absolute -right-1 top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-paper/85 text-ink shadow-card backdrop-blur transition hover:bg-paper"
          >
            <CaretRight weight="bold" className="size-5" />
          </button>
          <p className="mt-2 text-center font-round text-xs font-bold tracking-[0.2em] text-ink-soft">
            {idx + 1} / {count}
          </p>
        </>
      )}

      {mounted &&
        createPortal(
          <Lightbox
            photos={lightboxPhotos}
            index={zoom}
            onClose={() => setZoom(null)}
            onNav={(next) => setZoom(next)}
            canEdit={author}
            onCaptionChange={onCaption}
          />,
          document.body
        )}
    </div>
  );
}
