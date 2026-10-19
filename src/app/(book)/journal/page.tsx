import type { Metadata } from "next";
import Link from "next/link";
import { isAuthor, isReader } from "@/lib/auth";
import { listEntries } from "@/lib/entries";
import { seenMap } from "@/lib/marks";
import { getSettings, sectionOpen } from "@/lib/settings";
import { JournalBook } from "@/components/journal/JournalBook";
import { DoodleDivider } from "@/components/journal/DoodleDivider";
import { Sticker } from "@/components/journal/Sticker";
import { AddEntryButton } from "@/components/AddEntryButton";
import { GuestLock } from "@/components/GuestLock";
import { recordGuestVisitFor } from "@/lib/visitors";

export const metadata: Metadata = { title: "手账页" };

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await recordGuestVisitFor("/journal");
  const [reader, author, settings, sp] = [
    await isReader(),
    await isAuthor(),
    getSettings(),
    await searchParams,
  ];
  // 整栏没对访客公开：只给一扇门
  if (!reader && !sectionOpen(settings, "journal")) return <GuestLock section="手账" />;

  // 手账本只放手账页和自由拼贴页；照片在拍立得墙、语录在语录墙、信在信箱。
  // 访客只看标了「公开」的那几页
  const entries = listEntries({ excludeTypes: ["photo", "quote", "letter"], guest: !reader });
  // ?date=YYYY-MM-DD：从首页「回到那几天」直达某一天
  const rawDate = typeof sp.date === "string" ? sp.date : "";
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;

  return (
    <div className="py-10">
      <header className="text-center">
        <h1 className="text-4xl font-bold">手账页</h1>
        <p className="mt-3 text-ink-soft">一页一页翻过去，都是我们</p>
        <DoodleDivider variant="wave" className="mx-auto mt-6" />
        {author && (
          <div className="mt-6">
            <AddEntryButton href="/write?type=journal" icon="notebook" label="写一页新手账" />
          </div>
        )}
      </header>

      {entries.length === 0 ? (
        <div className="card-paper mx-auto mt-16 flex max-w-md flex-col items-center gap-4 py-14 text-center">
          <Sticker name="cloud" className="size-12 text-mist" />
          <p className="text-ink-soft">
            {reader ? "本子还空着，故事从下一页开始" : "能给你看的页面还在准备中"}
          </p>
          {author && (
            <Link href="/write?type=journal" className="btn-primary">
              写下第一页
            </Link>
          )}
        </div>
      ) : (
        <JournalBook
          entries={entries}
          author={author}
          reader={reader}
          initialDate={initialDate}
          seens={Object.fromEntries(seenMap(entries.map((e) => e.id)))}
        />
      )}
    </div>
  );
}
