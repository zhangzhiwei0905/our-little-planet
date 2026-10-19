"use client";

import { useEffect, useRef, useState } from "react";
import { Play, VideoCamera } from "@phosphor-icons/react";
import type { AlbumPickItem } from "./MilestoneManager";

/** 选择器格子里的方图缩略图（大事记 / 手账「从本子里选」共用）：
 *  照片直接用缩略图；视频优先服务端抽的封面，没有封面退 <video> 首帧
 *  （进视口才挂 src，一屏几十个视频也不会同时抢元信息），再放不了退摄像机图标——
 *  总能认出是哪一段 */
export function AlbumPickThumb({ item }: { item: AlbumPickItem }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || inView || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  if (item.kind !== "video") {
    /* eslint-disable-next-line @next/next/no-img-element -- 缩略图走带鉴权的 /api/media */
    return <img src={item.thumbUrl ?? item.url} alt={item.caption ?? "照片"} className="aspect-square w-full object-cover" />;
  }

  const poster = item.posterUrl ?? null;
  const usePoster = Boolean(poster && !posterFailed);
  const useVideo = !usePoster && inView && !videoFailed;
  return (
    <span ref={boxRef} className="relative block aspect-square w-full bg-ink/5">
      {usePoster ? (
        /* eslint-disable-next-line @next/next/no-img-element -- 视频封面，带鉴权的接口地址 */
        <img src={poster ?? undefined} alt={item.caption ?? "视频封面"} onError={() => setPosterFailed(true)} className="h-full w-full object-cover" />
      ) : useVideo ? (
        /* #t=0.1 让 iOS Safari 也显示出首帧；桌面 Chrome 解不了 HEVC 时 onError 退图标 */
        <video
          src={item.url.includes("#") ? item.url : `${item.url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          onError={() => setVideoFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="grid h-full w-full place-items-center text-ink-soft">
          <VideoCamera weight="duotone" className="size-7" />
        </span>
      )}
      {(usePoster || useVideo) && (
        <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid size-7 place-items-center rounded-full bg-ink/40 text-paper backdrop-blur-sm">
            <Play weight="fill" className="size-3.5 translate-x-px" />
          </span>
        </span>
      )}
    </span>
  );
}
