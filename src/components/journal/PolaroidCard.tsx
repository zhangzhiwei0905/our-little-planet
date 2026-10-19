"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Play } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { WashiTape } from "./WashiTape";
import { tiltOf, type TapeTone } from "@/lib/tilt";
import { tagColor } from "@/lib/tags";

/** 拍立得照片卡：白边相纸 + 手写注释，随手贴的微倾斜，
 *  hover 时像被拿起来；Live Photo 只亮 LIVE 角标，点开进灯箱用「LIVE 回放」按钮播放（带声音）；
 *  带 video 时是视频卡：显示首帧 + 播放角标，点开进灯箱播 */
export function PolaroidCard({
  src,
  fallbackSrc,
  video,
  poster,
  hevc,
  caption,
  date,
  alt,
  tags,
  tilt = 0,
  tone = "rose",
  tape = "center",
  width,
  height,
  liveVideo,
  captionLines = 2,
  fixedFrame = false,
  noHover = false,
  className,
}: {
  src?: string | null;
  /** 缩略图或签名预览地址失败时回落到原图/鉴权地址 */
  fallbackSrc?: string | null;
  /** 视频卡：传视频地址（拍立得墙上的视频） */
  video?: string | null;
  /** 视频封面图（服务端抽的第一帧）：优先用它，HEVC 视频浏览器解不出首帧也不怕 */
  poster?: string | null;
  /** 视频是否 HEVC 编码（显示提示角标） */
  hevc?: boolean | null;
  caption?: string | null;
  date?: string | null;
  alt?: string;
  /** 相册标签：照片下缘贴成小彩签（最多显示 3 个） */
  tags?: string[];
  tilt?: number;
  tone?: TapeTone;
  tape?: "center" | "left" | "right" | "none";
  width?: number | null;
  height?: number | null;
  /** Live Photo 标记：亮出 LIVE 角标（播放去灯箱里的按钮，能出声） */
  liveVideo?: string | null;
  /** 描述占几行（超出省略号）：首页大拍立得传 1，卡片高度才恒定不跳动 */
  captionLines?: 1 | 2;
  /** Fill a fixed carousel frame without changing its size or cropping the image. */
  fixedFrame?: boolean;
  /** 关掉「拿起来」悬浮效果（相册管理模式用）：悬浮的 z-10 会盖住勾选角标，动来动去也点不准 */
  noHover?: boolean;
  className?: string;
}) {
  const tapePos =
    tape === "center" ? "-top-3 left-1/2" : tape === "left" ? "-top-3 left-12" : tape === "right" ? "-top-3 right-6 left-auto translate-x-0" : "";

  // 视频卡：滚到视口附近才加载元信息（显示首帧），
  // 免得一墙视频卡打开页面就并发抢几十个元数据请求。
  //  服务端渲染时 inView 恒为 false（不挂 src），进视口后由观察器挂上
  const boxRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
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
      { rootMargin: "800px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);
  // 有服务端抽好的封面就用图（还能显示 HEVC 视频的首帧），加载失败再回落 <video>
  const usePoster = Boolean(video && poster && !posterFailed);
  const imageSrc = failedSrc === src && fallbackSrc ? fallbackSrc : src;

  return (
    <figure
      className={cn(
        "group relative select-none bg-white px-3 pt-3 pb-2.5 shadow-card [-webkit-touch-callout:none]",
        "transition-[transform,box-shadow] duration-500 ease-spring",
        !noHover && "hover:z-10 hover:[transform:rotate(0deg)_translateY(-8px)] hover:shadow-lifted",
        fixedFrame && "flex h-full min-h-0 flex-col",
        className
      )}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {tape !== "none" && (
        <WashiTape tone={tone} rotate={tilt > 0 ? -7 : 6} className={cn(tapePos, tape === "right" && "[transform:rotate(var(--r))]")} />
      )}
      <div
        ref={boxRef}
        className={cn("relative w-full overflow-hidden bg-[#f1e7d8]", fixedFrame && "min-h-0 flex-1")}
        style={fixedFrame ? undefined : width && height ? { aspectRatio: `${width} / ${height}` } : { aspectRatio: "4 / 5" }}
      >
        {usePoster ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- 视频封面图，带鉴权的接口地址 */}
            <img
              src={poster ?? undefined}
              alt={alt ?? caption ?? "视频封面"}
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setPosterFailed(true)}
              className={cn("h-full w-full", fixedFrame ? "object-contain" : "object-cover")}
            />
            <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="grid size-10 place-items-center rounded-full bg-ink/45 text-paper backdrop-blur-sm">
                <Play weight="fill" className="size-5 translate-x-px" />
              </span>
            </span>
          </>
        ) : video ? (
          <>
            {/* #t=0.1 让 iOS Safari 也显示出首帧，不然是一块黑；进视口才挂 src */}
            <video
              src={inView ? (video.includes("#") ? video : `${video}#t=0.1`) : undefined}
              muted
              playsInline
              preload="metadata"
              className={cn("h-full w-full", fixedFrame ? "object-contain" : "object-cover")}
            />
            <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="grid size-10 place-items-center rounded-full bg-ink/45 text-paper backdrop-blur-sm">
                <Play weight="fill" className="size-5 translate-x-px" />
              </span>
            </span>
          </>
        ) : src ? (
          /* 图片走 /api/media/[id]（鉴权后返回），next/image 优化器不适用这条鉴权路由 */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageSrc ?? undefined}
            alt={alt ?? caption ?? "我们的照片"}
            loading={fixedFrame ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
            onError={() => setFailedSrc(src ?? null)}
            className={cn("h-full w-full", fixedFrame ? "object-contain" : "object-cover")}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-ink-soft/70">
            <Camera weight="duotone" className="size-10" />
            <span className="text-sm">第一张照片等待中</span>
          </div>
        )}
        {video && hevc && (
          <span
            title="HEVC 编码：桌面 Chrome / Firefox 可能放不了，iPhone 和 Safari 没问题"
            className="absolute right-2.5 top-2.5 rounded-full bg-butter/95 px-2 py-0.5 text-[10px] font-bold text-[#5c4a42]"
          >
            HEVC
          </span>
        )}
        {liveVideo && (
          <span
            aria-hidden
            className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-ink/55 px-2 py-0.5 text-[10px] font-bold tracking-[0.18em] text-paper/95 backdrop-blur"
          >
            <span className="size-1.5 rounded-full bg-rose" />
            LIVE
          </span>
        )}
      </div>
      <figcaption className={cn("polaroid-caption px-1 pt-2 pb-0.5 text-center", fixedFrame && "h-[4.375rem] shrink-0 overflow-hidden")}>
        {caption && (
          <p className={cn("font-script text-2xl leading-tight text-ink/90", captionLines === 1 ? "line-clamp-1" : "line-clamp-2")}>
            {caption}
          </p>
        )}
        {date && !caption && <p className="font-round text-sm tracking-widest text-ink-soft">{date.replaceAll("-", ".")}</p>}
        {tags && tags.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
            {tags.slice(0, 3).map((t) => (
              <span
                key={t}
                title={t}
                className="rounded-full px-2 py-px font-hand text-[13px] leading-snug text-ink shadow-sm"
                style={{ background: tagColor(t), transform: `rotate(${tiltOf(t + "-card", 2)}deg)` }}
              >
                {t}
              </span>
            ))}
            {tags.length > 3 && (
              <span title={tags.slice(3).join("、")} className="font-round text-[11px] font-bold text-ink-soft/70">
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}
      </figcaption>
    </figure>
  );
}
