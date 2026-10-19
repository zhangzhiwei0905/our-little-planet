import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAuthor, isEggUnlocked } from "@/lib/auth";
import { eggPhotos, getEgg } from "@/lib/eggs";
import { getSettings } from "@/lib/settings";
import { todayLocal } from "@/lib/ids";
import { EggGate } from "@/components/someday/EggGate";
import { EggExperience } from "@/components/someday/EggExperience";
import { Sticker } from "@/components/journal/Sticker";
import { DoodleDivider } from "@/components/journal/DoodleDivider";
import { recordGuestVisitFor } from "@/lib/visitors";

export const metadata: Metadata = { title: "Someday" };

/** 单个彩蛋：独立于手账总锁——只凭「揭晓日期 + 彩蛋密码」就能打开，
 *  链接发给她后不需要再输本子的读者密码 */
export default async function EggPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await recordGuestVisitFor(`/someday/${id}`);
  const egg = getEgg(id);
  if (!egg) notFound();

  // 未到期：显示通用封印页，不暴露任何信息
  if (todayLocal() < egg.revealDate) {
    return (
      <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-16 text-center">
        <div className="card-paper max-w-sm px-8 py-12">
          <h1 className="text-2xl font-bold">还没到打开的时候</h1>
          <p className="mt-4 leading-relaxed text-ink-soft">这一页藏着一个礼物，它在等一个特别的日子。</p>
          <DoodleDivider variant="wave" className="mx-auto mt-8" />
          <p className="mt-6 font-script text-2xl text-ink-soft/70">come back someday</p>
        </div>
      </main>
    );
  }

  if (!(await isEggUnlocked(egg.id))) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-16">
        <EggGate eggId={egg.id} title={egg.title} />
      </main>
    );
  }

  const photos = eggPhotos(egg).map((p) => ({
    id: p.id,
    url: p.url,
    caption: p.caption,
    width: p.width,
    height: p.height,
    thumbUrl: p.thumbUrl,
    liveVideo: p.liveVideo,
    kind: p.kind === "video" ? ("video" as const) : ("photo" as const),
    posterUrl: p.posterUrl,
    hevc: p.hevc,
  }));

  return (
    <main className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <Sticker name="heart" className="absolute left-[10%] top-[8%] size-9 rotate-[-10deg] text-rose/40" />
        <Sticker name="star" className="absolute right-[12%] top-[14%] size-8 rotate-12 text-butter/70" />
        <Sticker name="flower" className="absolute bottom-[10%] left-[16%] size-11 rotate-6 text-matcha/50" />
        <Sticker name="cloud" className="absolute bottom-[16%] right-[10%] size-12 -rotate-6 text-mist/50" />
      </div>
      <EggExperience
        eggId={egg.id}
        title={egg.title}
        letter={egg.letter}
        startDate={getSettings().startDate}
        photos={photos}
        author={await isAuthor()}
      />
    </main>
  );
}
