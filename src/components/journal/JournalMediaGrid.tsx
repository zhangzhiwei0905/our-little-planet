"use client";

import { useCallback, useState } from "react";
import { PolaroidCard } from "@/components/journal/PolaroidCard";
import { Lightbox, type LightboxPhoto } from "@/components/album/Lightbox";
import { tiltOf } from "@/lib/tilt";
import type { PublicMedia } from "@/lib/entries";

function photoGridClass(n: number): string {
  if (n === 1) return "mt-6 max-w-xs";
  if (n === 2) return "mt-6 grid max-w-xl gap-5 grid-cols-2";
  return "mt-6 grid max-w-2xl gap-5 grid-cols-2 sm:grid-cols-3";
}

/** 手账页里的照片/视频墙：照片点击进灯箱放大（视频保留原生播放控件）。
 *  作者在灯箱里改过的描述回填这份本地状态，墙上的拍立得和视频下的字跟着换 */
export function JournalMediaGrid({
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
  const [items, setItems] = useState(media);
  const [index, setIndex] = useState<number | null>(null);

  const onCaption = useCallback((id: string, caption: string | null) => {
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, caption } : m)));
  }, []);

  const photos: (LightboxPhoto & { orig: number })[] = items.flatMap((m, i) =>
    m.kind === "video"
      ? []
      : [
          {
            orig: i,
            id: m.id,
            url: m.url,
            caption: m.caption,
            entryDate,
            width: m.width,
            height: m.height,
            kind: "photo" as const,
            hevc: m.hevc,
            liveVideo: m.liveVideo,
          },
        ]
  );
  const lightboxIndexOf = (orig: number) => photos.findIndex((p) => p.orig === orig);

  return (
    <div className={photoGridClass(items.length)}>
      {items.map((m, i) =>
        m.kind === "video" ? (
          <div key={m.id} className="overflow-hidden rounded-xl border border-ink/10 bg-ink/5 shadow-card">
            {/* src 直挂不用 <source type>：Chrome 对 video/quicktime 报「不支持」会跳过 source，.mov 就加载不出来 */}
            <video src={m.url} controls preload="metadata" playsInline poster={m.posterUrl ?? undefined} className="w-full" />
            {m.caption && <p className="px-3 py-2 font-script text-xl text-ink/90">{m.caption}</p>}
          </div>
        ) : (
          <button key={m.id} type="button" onClick={() => setIndex(lightboxIndexOf(i))} className="block w-full cursor-zoom-in" aria-label={m.caption ?? "放大看这张照片"}>
            <PolaroidCard
              src={m.thumbUrl ?? m.url}
              caption={m.caption}
              alt={m.caption ?? "我们的照片"}
              tilt={tiltOf(m.id, 2)}
              tone={tone as never}
              tape="none"
              width={m.width}
              height={m.height}
              liveVideo={m.liveVideo}
            />
          </button>
        )
      )}
      <Lightbox photos={photos} index={index} onClose={() => setIndex(null)} onNav={setIndex} canEdit={author} onCaptionChange={onCaption} />
    </div>
  );
}
