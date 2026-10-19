import type { Metadata } from "next";
import { isAuthor, isReader } from "@/lib/auth";
import { getSettings, sectionOpen } from "@/lib/settings";
import { listScreenings } from "@/lib/screenings";
import { ScreeningWall } from "@/components/screenings/ScreeningWall";
import { DoodleDivider } from "@/components/journal/DoodleDivider";
import { Sticker } from "@/components/journal/Sticker";
import { GuestLock } from "@/components/GuestLock";
import { AddEntryButton } from "@/components/AddEntryButton";
import { recordGuestVisitFor } from "@/lib/visitors";

export const metadata: Metadata = { title: "放映室" };

/** 放映室：每一段完整的纪念视频，是一场只放给她看的首映 */
export default async function ScreeningsPage() {
  await recordGuestVisitFor("/screenings");
  const [reader, author, settings] = [await isReader(), await isAuthor(), getSettings()];
  if (!reader && !sectionOpen(settings, "screenings")) return <GuestLock section="放映室" />;

  const screenings = listScreenings({ includeUnpublished: author, guest: !reader });

  return (
    <div className="py-10">
      <header className="mb-4 text-center">
        <p className="font-script text-2xl text-rose-deep">now showing</p>
        <h1 className="mt-2 text-4xl font-bold">放映室</h1>
        <p className="mt-3 text-ink-soft">一场一场的首映，都是只放给你一个人的电影</p>
        <DoodleDivider variant="wave" className="mx-auto mt-6" />
        {author && (
          <div className="mt-6">
            <AddEntryButton href="/write/screenings" icon="letter" label="排一场新的首映" />
          </div>
        )}
      </header>

      {screenings.length === 0 ? (
        <div className="card-paper mx-auto mt-16 flex max-w-md flex-col items-center gap-4 py-14 text-center">
          <Sticker name="star" className="size-12 text-butter" />
          <p className="text-ink-soft">
            {reader ? "银幕还空着。第一场电影，在等一个特别的日子" : "能给你看的场次还在排片"}
          </p>
        </div>
      ) : (
        <ScreeningWall screenings={screenings} author={author} reader={reader} />
      )}
    </div>
  );
}
