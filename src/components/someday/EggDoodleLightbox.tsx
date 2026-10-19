"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CaretLeft, CaretRight, Check, PencilSimple, Sparkle, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/Toast";
import { CaptionQuickEdit } from "@/components/CaptionQuickEdit";

export type EggPhotoItem = {
  id: string;
  url: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  /** 照片墙用的缩略图 */
  thumbUrl?: string | null;
  /** Live Photo 的配对视频（点「LIVE 回放」按钮播放，带声音） */
  liveVideo?: string | null;
  /** 彩蛋里也能选视频：照片墙显示封面，点开直接播放（视频不能涂鸦留言） */
  kind?: "photo" | "video";
  /** 视频封面（服务端抽的第一帧） */
  posterUrl?: string | null;
  /** 视频是否 HEVC 编码（放不了时提示） */
  hevc?: boolean | null;
};

type Stroke = { color: string; size: number; points: number[][] };

/** 画笔：暖白 / 墨棕 / 玫瑰深 / 黄油黄，照片上都看得清 */
const PENS = [
  { color: "#ffffff", cls: "bg-white" },
  { color: "#5c4a42", cls: "bg-[#5c4a42]" },
  { color: "#b4506b", cls: "bg-rose-deep" },
  { color: "#f7e3a1", cls: "bg-butter" },
];
const SIZES = [0.005, 0.012]; // 归一化线宽（相对画布短边）

/** 叠在照片上的画布 / 实况视频：canvas 和 video 是替换元素，absolute + 四边定位撑不开，
 *  会停在固有尺寸（canvas 默认 300×150），所以宽高显式给成照片内容区（img 有 p-2.5 的白边） */
const OVERLAY_BOX = { left: "0.625rem", top: "0.625rem", width: "calc(100% - 1.25rem)", height: "calc(100% - 1.25rem)" };

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
  if (s.points.length === 0) return;
  const base = Math.min(w, h);
  ctx.strokeStyle = s.color;
  ctx.lineWidth = Math.max(2, s.size * base);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(s.points[0][0] * w, s.points[0][1] * h);
  for (const p of s.points.slice(1)) ctx.lineTo(p[0] * w, p[1] * h);
  if (s.points.length === 1) ctx.lineTo(s.points[0][0] * w + 0.5, s.points[0][1] * h + 0.5);
  ctx.stroke();
}

/** 彩蛋灯箱：看大图 + 在照片上留下手绘的话 */
export function EggDoodleLightbox({
  eggId,
  photos,
  index,
  doodleCounts,
  onClose,
  onNav,
  onDoodleSaved,
  canEdit = false,
  onCaptionChange,
}: {
  eggId: string;
  photos: EggPhotoItem[];
  index: number | null;
  doodleCounts: Map<string, number>;
  onClose: () => void;
  onNav: (next: number) => void;
  onDoodleSaved?: (photoId: string) => void;
  canEdit?: boolean;
  onCaptionChange?: (id: string, caption: string | null) => void;
}) {
  const toast = useToast();
  const reduce = useReducedMotion();
  const open = index !== null && index >= 0 && index < photos.length;
  const photo = open ? photos[index!] : null;
  // 彩蛋里的视频：直接播放（视频上没法涂鸦留言，那是照片专属）
  const isVideo = photo?.kind === "video";
  const [videoErr, setVideoErr] = useState(false);

  const [mode, setMode] = useState<"view" | "draw">("view");
  const [imgLoaded, setImgLoaded] = useState(0);
  const [pen, setPen] = useState(0);
  const [thick, setThick] = useState(0);
  const [savedStrokes, setSavedStrokes] = useState<Stroke[]>([]);
  const [sessionStrokes, setSessionStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const [saving, setSaving] = useState(false);
  const [counts, setCounts] = useState(doodleCounts);
  // 查看模式：点「LIVE 回放」按钮播放实况（带声音）；视频预取成内存 blob，点了零缓冲
  const [liveOn, setLiveOn] = useState(false);
  const [liveSrc, setLiveSrc] = useState<string | null>(null);
  const [liveWarming, setLiveWarming] = useState(false);
  const liveVideoEl = useRef<HTMLVideoElement>(null);
  const liveBlob = useRef<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  // 打开这张照片就把实况视频拉到内存（302 签名地址不可缓存，按需拉会等半天）
  useEffect(() => {
    if (!photo?.liveVideo) return;
    let cancelled = false;
    fetch(photo.liveVideo)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (cancelled || !b) return;
        liveBlob.current = URL.createObjectURL(b);
        setLiveSrc(liveBlob.current);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (liveBlob.current) {
        URL.revokeObjectURL(liveBlob.current);
        liveBlob.current = null;
      }
    };
  }, [photo?.id, photo?.liveVideo]);

  function toggleLive() {
    const v = liveVideoEl.current;
    if (!v || !photo?.liveVideo) return;
    if (liveOn) {
      v.pause();
      setLiveOn(false);
      setLiveWarming(false);
      return;
    }
    v.currentTime = 0;
    v.muted = false; // 按钮是真实点击手势，可以带声音
    setLiveOn(true);
    setLiveWarming(true);
    void v.play().catch(() => {
      v.muted = true;
      void v.play().catch(() => undefined);
    });
  }

  const repaint = useCallback((all: Stroke[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // canvas 由四边内缩定位撑开，直接读布局尺寸
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    for (const s of all) drawStroke(ctx, s, w, h);
  }, []);

  // 打开照片：拉取这张照片已有的留言（组件由父级 key={index} 重挂载，切换照片时状态天然干净）
  useEffect(() => {
    if (!photo || photo.kind === "video") return;
    fetch(`/api/eggs/${eggId}/doodles?photoId=${photo.id}`)
      .then((r) => (r.ok ? r.json() : { doodles: [] }))
      .then((d: { doodles: { strokes: Stroke[] }[] }) => {
        setSavedStrokes(d.doodles.flatMap((x) => x.strokes ?? []));
      })
      .catch(() => setSavedStrokes([]));
  }, [photo, eggId]);

  // 涂鸦变化时重绘
  useEffect(() => {
    if (mode !== "view" && mode !== "draw") return;
    repaint([...savedStrokes, ...sessionStrokes, ...(current ? [current] : [])]);
  }, [savedStrokes, sessionStrokes, current, mode, repaint, imgLoaded]);

  // 键盘与滚动锁定
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (mode === "draw") return; // 画的时候不切图
      // 正在改描述时 Esc / 方向键留给输入框
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index !== null) onNav((index - 1 + photos.length) % photos.length);
      if (e.key === "ArrowRight" && index !== null) onNav((index + 1) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, mode, onClose, onNav, index, photos.length]);

  function pos(e: React.PointerEvent): number[] {
    const r = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  async function finishDrawing() {
    const strokes = [...sessionStrokes];
    if (strokes.length === 0) {
      setMode("view");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/eggs/${eggId}/doodles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId: photo!.id, strokes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "留言没存上");
      setSavedStrokes((prev) => [...prev, ...strokes]);
      setSessionStrokes([]);
      setCounts((m) => new Map(m).set(photo!.id, (m.get(photo!.id) ?? 0) + 1));
      setMode("view");
      toast("你的话留在这张照片上了");
      onDoodleSaved?.(photo!.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "留言没存上", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {photo && (
        <motion.div
          key="egg-lightbox"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink/70 p-4 backdrop-blur-sm sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={() => mode === "view" && onClose()}
        >
          <motion.figure
            key={photo.id}
            className="relative flex max-h-full flex-col items-center"
            initial={reduce ? false : { scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative select-none [-webkit-touch-callout:none] [touch-action:none]">
              {isVideo ? (
                <>
                  <video
                    src={photo.url}
                    poster={photo.posterUrl ?? undefined}
                    controls
                    autoPlay
                    playsInline
                    onError={() => setVideoErr(true)}
                    className="max-h-[68vh] max-w-full rounded-lg bg-ink shadow-lifted"
                  />
                  {videoErr && (
                    <p className="mt-3 max-w-md text-center font-round text-sm leading-relaxed text-paper/80">
                      这个浏览器放不了这段视频{photo.hevc ? "（HEVC 编码）" : ""}，用 iPhone / Mac 打开没问题。
                    </p>
                  )}
                </>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={photo.url}
                  alt={photo.caption ?? "我们的照片"}
                  draggable={false}
                  onLoad={() => setImgLoaded((n) => n + 1)}
                  className="max-h-[68vh] max-w-full rounded-lg bg-white p-2.5 shadow-lifted"
                />
              )}
              {photo.liveVideo && (
                <video
                  ref={liveVideoEl}
                  src={liveSrc ?? photo.liveVideo}
                  playsInline
                  preload="metadata"
                  onPlaying={() => setLiveWarming(false)}
                  onWaiting={() => setLiveWarming(true)}
                  onEnded={() => setLiveOn(false)}
                  className={cn(
                    "absolute rounded-lg object-cover transition-opacity duration-150",
                    liveOn ? "opacity-100" : "pointer-events-none opacity-0"
                  )}
                  style={OVERLAY_BOX}
                />
              )}
              {photo.liveVideo && !liveOn && !liveWarming && (
                <span className="pointer-events-none absolute left-4 top-4 flex items-center gap-1 rounded-full bg-ink/55 px-2 py-0.5 text-[10px] font-bold tracking-[0.18em] text-paper backdrop-blur">
                  <span className="size-1.5 rounded-full bg-rose" />
                  LIVE
                </span>
              )}
              {liveWarming && (
                <span className="pointer-events-none absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-ink/55 px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-paper backdrop-blur">
                  <span className="size-1.5 animate-pulse rounded-full bg-butter" />
                  实况加载中
                </span>
              )}
              {!isVideo && (
              <canvas
                ref={canvasRef}
                className={cn(
                  "absolute rounded-lg select-none [touch-action:none]",
                  mode === "draw" ? "cursor-crosshair" : "pointer-events-none"
                )}
                style={OVERLAY_BOX}
                onPointerDown={(e) => {
                  if (mode !== "draw") return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drawing.current = true;
                  setCurrent({ color: PENS[pen].color, size: SIZES[thick], points: [pos(e)] });
                }}
                onPointerMove={(e) => {
                  if (!drawing.current) return;
                  const p = pos(e);
                  setCurrent((c) => (c ? { ...c, points: [...c.points, p] } : c));
                }}
                onPointerUp={() => {
                  if (!drawing.current) return;
                  drawing.current = false;
                  setCurrent((c) => {
                    if (c && c.points.length > 0) setSessionStrokes((s) => [...s, c]);
                    return null;
                  });
                }}
                onPointerCancel={() => {
                  // 手机上系统手势/来电等会打断笔画：没画完的这条直接丢弃，别卡住画笔
                  if (!drawing.current) return;
                  drawing.current = false;
                  setCurrent(null);
                }}
              />
              )}
              {!isVideo && counts.get(photo.id) ? (
                <span className="absolute right-4 top-4 flex items-center gap-1 rounded-full bg-ink/55 px-2.5 py-1 text-[11px] font-bold tracking-wider text-paper backdrop-blur">
                  <Sparkle weight="fill" className="size-3 text-butter" />
                  有 {counts.get(photo.id)} 句留言
                </span>
              ) : null}
            </div>

            <figcaption className="mt-4 flex items-baseline gap-3 text-paper">
              {canEdit ? (
                <CaptionQuickEdit
                  mediaId={photo.id}
                  caption={photo.caption}
                  onSaved={(c) => onCaptionChange?.(photo.id, c)}
                />
              ) : (
                photo.caption && <span className="font-script text-3xl leading-none">{photo.caption}</span>
              )}
              <span className="font-round text-sm tracking-widest opacity-70">
                {index! + 1} / {photos.length}
              </span>
            </figcaption>

            {/* 画笔工具条（绘制模式） */}
            <div
              className={cn(
                "mt-4 flex items-center gap-3 rounded-full bg-paper px-4 py-2.5 shadow-lifted",
                mode === "draw" ? "flex" : "hidden"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {PENS.map((p, i) => (
                <button
                  key={p.color}
                  type="button"
                  aria-label={`画笔颜色 ${i + 1}`}
                  onClick={() => setPen(i)}
                  className={cn(
                    "size-7 rounded-full border-2 transition",
                    p.cls,
                    pen === i ? "border-ink scale-110" : "border-transparent opacity-70"
                  )}
                />
              ))}
              <span className="h-5 w-px bg-ink/15" />
              {SIZES.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`粗细 ${i + 1}`}
                  onClick={() => setThick(i)}
                  className={cn("grid size-7 place-items-center rounded-full transition", thick === i ? "bg-ink/10" : "opacity-60")}
                >
                  <span className={cn("rounded-full bg-ink", i === 0 ? "size-1.5" : "size-3")} />
                </button>
              ))}
              <span className="h-5 w-px bg-ink/15" />
              <button
                type="button"
                onClick={() => setSessionStrokes((s) => s.slice(0, -1))}
                className="rounded-full px-3 py-1 text-sm font-bold text-ink-soft transition hover:bg-ink/5"
              >
                撤销
              </button>
              <button type="button" disabled={saving} onClick={() => void finishDrawing()} className="btn-primary px-4 py-1.5 text-sm">
                <Check weight="bold" className="size-4" />
                {saving ? "保存中…" : "留好了"}
              </button>
            </div>

            {/* 查看模式操作 */}
            {mode === "view" && (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                {photo.liveVideo && !isVideo && (
                  <button type="button" onClick={toggleLive} className="btn-ghost px-5 py-2 text-sm">
                    <CaretRight weight="bold" className="size-4" />
                    {liveOn ? "停止" : "LIVE 回放"}
                  </button>
                )}
                {!isVideo && (
                <button
                  type="button"
                  onClick={() => {
                    setSessionStrokes([]);
                    liveVideoEl.current?.pause();
                    setLiveOn(false);
                    setMode("draw");
                  }}
                  className="btn-primary px-5 py-2 text-sm"
                >
                  <PencilSimple weight="bold" className="size-4" />
                  {counts.get(photo.id) ? "再写一句" : "在这张照片上写句话"}
                </button>
                )}
              </div>
            )}
          </motion.figure>

          {mode === "view" && photos.length > 1 && (
            <>
              <button
                type="button"
                aria-label="上一张"
                onClick={(e) => {
                  e.stopPropagation();
                  if (index !== null) onNav((index - 1 + photos.length) % photos.length);
                }}
                className="absolute left-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-paper/15 text-paper backdrop-blur transition hover:bg-paper/30"
              >
                <CaretLeft weight="bold" className="size-6" />
              </button>
              <button
                type="button"
                aria-label="下一张"
                onClick={(e) => {
                  e.stopPropagation();
                  if (index !== null) onNav((index + 1) % photos.length);
                }}
                className="absolute right-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-paper/15 text-paper backdrop-blur transition hover:bg-paper/30"
              >
                <CaretRight weight="bold" className="size-6" />
              </button>
            </>
          )}
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-paper/15 text-paper backdrop-blur transition hover:bg-paper/30"
          >
            <X weight="bold" className="size-5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
