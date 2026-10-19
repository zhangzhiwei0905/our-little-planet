import type { Metadata } from "next";
import Link from "next/link";
import { isAuthor, isReader } from "@/lib/auth";
import { listEntries } from "@/lib/entries";
import { seenMap, repliesFor } from "@/lib/marks";
import { getSettings, sectionOpen } from "@/lib/settings";
import { LetterWall } from "@/components/letters/LetterWall";
import { DoodleDivider } from "@/components/journal/DoodleDivider";
import { Sticker } from "@/components/journal/Sticker";
import { AddEntryButton } from "@/components/AddEntryButton";
import { GuestLock } from "@/components/GuestLock";
import { recordGuestVisitFor } from "@/lib/visitors";

export const metadata: Metadata = { title: "信箱" };

export default async function LettersPage() {
  await recordGuestVisitFor("/letters");
  const [reader, author, settings] = [await isReader(), await isAuthor(), getSettings()];
  if (!reader && !sectionOpen(settings, "letters")) return <GuestLock section="信箱" />;

  // 访客只看标了「公开」的信；她寄回来的评论只属于她，访客看不到
  const letters = listEntries({ type: "letter", guest: !reader });
  const seens = seenMap(letters.map((l) => l.id));

  return (
    <div className="py-10">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold">信箱</h1>
        <p className="mt-3 text-ink-soft">点一下信封，把信拆开</p>
        <DoodleDivider variant="hearts" className="mx-auto mt-6 w-28" />
        {author && (
          <div className="mt-6">
            <AddEntryButton href="/write?type=letter" icon="letter" label="再写一封信" />
          </div>
        )}
      </header>

      {letters.length === 0 ? (
        <div className="card-paper mx-auto mt-16 flex max-w-md flex-col items-center gap-4 py-14 text-center">
          <Sticker name="cloud" className="size-12 text-mist" />
          <p className="text-ink-soft">{reader ? "信箱还空着，第一封信在等你落笔" : "能给你看的信还在路上"}</p>
          {author && (
            <Link href="/write?type=letter" className="btn-primary">
              写第一封信
            </Link>
          )}
        </div>
      ) : (
        <LetterWall
          author={author}
          letters={letters.map(({ id, title, body, entry_date }) => ({
            id,
            title,
            body,
            entryDate: entry_date,
            mood: null,
            index: 0,
            seenAt: reader ? (seens.get(id) ?? null) : null,
            replies: reader ? repliesFor(id) : [],
            reader,
          }))}
        />
      )}
    </div>
  );
}
