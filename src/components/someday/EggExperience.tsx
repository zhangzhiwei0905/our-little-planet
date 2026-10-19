"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EnvelopeSimple, Heart, Images, Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { DayCounter } from "@/components/home/DayCounter";
import { EntryText } from "@/components/journal/EntryText";
import { PolaroidCard } from "@/components/journal/PolaroidCard";
import { tiltOf, pickOf } from "@/lib/tilt";
import { EggDoodleLightbox, type EggPhotoItem } from "./EggDoodleLightbox";

type Phase = "ready" | "wall" | "letter" | "finale";

/** 彩蛋体验：封面 → 照片墙（可在照片上留言）→ 长信 → 结尾 */
export function EggExperience({
  eggId,
  title,
  letter,
  startDate,
  photos,
  author = false,
}: {
  eggId: string;
  title: string;
  letter: string;
  startDate: string;
  photos: EggPhotoItem[];
  author?: boolean;
}) {
  const reduce = useReducedMotion();
  // 作者预览时在灯箱里改过的描述，回填这份本地状态，墙上的拍立得跟着换字
  const [wallPhotos, setWallPhotos] = useState(photos);
  const onCaption = useCallback((id: string, caption: string | null) => {
    setWallPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, caption } : p)));
  }, []);
  const [phase, setPhase] = useState<Phase>("ready");
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());

  // 留言角标：哪些照片已经有她的话
  const loadCounts = () => {
    fetch(`/api/eggs/${eggId}/doodles`)
      .then((r) => (r.ok ? r.json() : { doodles: [] }))
      .then((d: { doodles: { photoId: string }[] }) => {
        const m = new Map<string, number>();
        for (const x of d.doodles ?? []) m.set(x.photoId, (m.get(x.photoId) ?? 0) + 1);
        setCounts(m);
      })
      .catch(() => undefined);
  };
  useEffect(() => {
    if (phase === "wall") loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, eggId]);

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-16">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-gradient-to-b from-paper via-rose-soft/30 to-paper" />

      <AnimatePresence mode="wait">
        {/* 封面 */}
        {phase === "ready" && (
          <motion.div
            key="ready"
            className="relative z-10 text-center"
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="font-script text-3xl text-rose-deep">the day has come</p>
            <h1 className="scribble mt-4 inline-block pb-2 text-5xl font-bold leading-tight sm:text-6xl">{title}</h1>
            <p className="mx-auto mt-6 max-w-sm leading-relaxed text-ink-soft">
              你发现了一个藏了很久的秘密。{photos.length > 0 ? `这里有 ${photos.length} 段回忆和一封信，都在等你。` : "有一封信，在等你。"}
            </p>
            <button
              type="button"
              onClick={() => setPhase(photos.length > 0 ? "wall" : "letter")}
              className="btn-primary mt-10 px-10 py-3.5 text-lg"
            >
              <Heart weight="fill" className="size-5" />
              翻开它
            </button>
          </motion.div>
        )}

        {/* 照片墙：点开照片可以在上面留言 */}
        {phase === "wall" && (
          <motion.section
            key="wall"
            className="relative z-10 w-full max-w-4xl"
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <header className="mb-10 text-center">
              <h2 className="text-3xl font-bold">{title}</h2>
              <p className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-ink-soft">
                <Sparkle weight="fill" className="size-4 text-butter" />
                点开照片可以在上面写下你最想说的话，视频点开就能播放
              </p>
            </header>
            <div className="columns-2 gap-6 sm:columns-3 lg:columns-4 [&>*]:mb-6">
              {wallPhotos.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  className="relative block w-full cursor-zoom-in break-inside-avoid"
                  onClick={() => setOpenIdx(i)}
                  aria-label={p.caption ?? "点开这张照片"}
                >
                  <PolaroidCard
                    src={p.thumbUrl ?? p.url}
                    video={p.kind === "video" ? p.url : null}
                    poster={p.kind === "video" ? p.posterUrl : null}
                    hevc={p.kind === "video" ? p.hevc : null}
                    caption={p.caption}
                    alt={p.caption ?? "我们的照片"}
                    tilt={tiltOf(p.id)}
                    tone={pickOf(p.id, ["rose", "butter", "mist", "peach", "matcha"])}
                    tape="none"
                    width={p.width}
                    height={p.height}
                    liveVideo={p.liveVideo}
                    className="w-full"
                  />
                  {counts.get(p.id) ? (
                    <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-ink/55 px-2 py-0.5 text-[10px] font-bold tracking-wider text-paper backdrop-blur">
                      <Sparkle weight="fill" className="size-3 text-butter" />
                      有话
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className={cn("mt-12 text-center")}>
              <button type="button" onClick={() => setPhase("letter")} className="btn-primary">
                <EnvelopeSimple weight="fill" className="size-5" />
                去读那封信
              </button>
            </div>
          </motion.section>
        )}

        {/* 长信 */}
        {phase === "letter" && (
          <motion.article
            key="letter"
            className="letter-paper relative z-10 my-6 w-full max-w-2xl rounded-lg px-7 pb-12 pt-10 shadow-lifted sm:px-12"
            initial={reduce ? false : { opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="font-script text-3xl leading-none text-rose-deep">for you, today</p>
            <h2 className="mt-3 text-3xl font-bold">{title}</h2>
            <div className="mt-8">
              <EntryText text={letter} lined />
            </div>
            <footer className="mt-10 text-right">
              <p className="font-script text-3xl text-ink/85">always yours</p>
            </footer>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              {photos.length > 0 && (
                <button type="button" onClick={() => setPhase("wall")} className="btn-ghost">
                  <Images weight="fill" className="size-4" />
                  回去看看照片
                </button>
              )}
              <button type="button" onClick={() => setPhase("finale")} className="btn-primary">
                <Heart weight="fill" className="size-5" />
                我看完了
              </button>
            </div>
          </motion.article>
        )}

        {/* 结尾 */}
        {phase === "finale" && (
          <motion.div
            key="finale"
            className="relative z-10 text-center"
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <DayCounter startDate={startDate} className="mx-auto w-fit" />
            <p className="mx-auto mt-8 max-w-md text-lg leading-relaxed">
              这只是到今天为止的部分。
              <br />
              往后的每一页，我们一起写。
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link href="/journal" className="btn-primary">
                <Images weight="fill" className="size-5" />
                去翻我们的手账
              </Link>
              <Link href="/letters" className="btn-ghost">
                <EnvelopeSimple weight="fill" className="size-4" />
                去信箱
              </Link>
            </div>
            <p className="mt-8 font-script text-2xl text-ink-soft/70">happy someday, my love</p>
          </motion.div>
        )}
      </AnimatePresence>

      <EggDoodleLightbox
        key={openIdx ?? "closed"}
        eggId={eggId}
        photos={wallPhotos}
        index={openIdx}
        doodleCounts={counts}
        onClose={() => setOpenIdx(null)}
        onNav={setOpenIdx}
        onDoodleSaved={(pid) => setCounts((m) => new Map(m).set(pid, (m.get(pid) ?? 0) + 1))}
        canEdit={author}
        onCaptionChange={onCaption}
      />
    </div>
  );
}
