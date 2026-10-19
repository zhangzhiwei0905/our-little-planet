import type { Metadata } from "next";
import Link from "next/link";
import { listAlbum } from "@/lib/entries";
import { isAuthor, isReader } from "@/lib/auth";
import { getSettings, sectionOpen } from "@/lib/settings";
import { listAllTags } from "@/lib/tagStore";
import { AlbumGrid } from "@/components/album/AlbumGrid";
import { DoodleDivider } from "@/components/journal/DoodleDivider";
import { Sticker } from "@/components/journal/Sticker";
import { AddEntryButton } from "@/components/AddEntryButton";
import { GuestLock } from "@/components/GuestLock";
import { recordGuestVisitFor } from "@/lib/visitors";

export const metadata: Metadata = { title: "拍立得墙" };

export default async function AlbumPage() {
  await recordGuestVisitFor("/album");
  const [reader, author, settings] = [await isReader(), await isAuthor(), getSettings()];
  if (!reader && !sectionOpen(settings, "album")) return <GuestLock section="相册" />;
  // 访客只看得到公开页上的照片
  const photos = await Promise.resolve(listAlbum({ guest: !reader }));
  const knownTags = author ? listAllTags() : [];

  return (
    <div className="py-10">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold">拍立得墙</h1>
        <p className="mt-3 text-ink-soft">共 {photos.length} 个瞬间，随便翻，别客气</p>
        <DoodleDivider variant="wave" className="mx-auto mt-6" />
        {author && (
          <div className="mt-6">
            <AddEntryButton href="/write?type=photo" icon="camera" label="传照片 / 视频" />
          </div>
        )}
      </header>

      {photos.length === 0 ? (
        <div className="card-paper mx-auto mt-16 flex max-w-md flex-col items-center gap-4 py-14 text-center">
          <Sticker name="star" className="size-12 text-butter" />
          <p className="text-ink-soft">{reader ? "墙上还空空的，第一张拍立得在等你" : "能给你看的照片还在准备中"}</p>
          {author && (
            <Link href="/write?type=photo" className="btn-primary">
              贴第一张
            </Link>
          )}
        </div>
      ) : (
        <AlbumGrid photos={photos} author={author} knownTags={knownTags} />
      )}
    </div>
  );
}
