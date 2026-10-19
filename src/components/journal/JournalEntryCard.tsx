import Link from "next/link";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr";
import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import type { EntryWithMedia } from "@/lib/entries";
import { pickOf, tiltOf, NOTE_TONES, TAPE_TONES } from "@/lib/tilt";
import { WashiTape } from "./WashiTape";
import { Sticker, isStickerName } from "./Sticker";
import { DateStamp } from "./DateStamp";
import { StickyNote } from "./StickyNote";
import { EntryText } from "./EntryText";
import { BoardZoom } from "./BoardZoom";
import { JournalMediaGrid } from "./JournalMediaGrid";
import { SeenStamp } from "@/components/marks/SeenStamp";
import { CommentBox } from "@/components/marks/CommentBox";

/** 手账页卡片：一页手账（日记 / 照片堆 / 语录便利贴） */
export function JournalEntryCard({
  entry,
  author = false,
  compact = false,
  seenAt = null,
  reader = false,
}: {
  entry: EntryWithMedia;
  author?: boolean;
  compact?: boolean;
  /** 她的已阅印章日期（ISO）；null = 还没盖 */
  seenAt?: string | null;
  /** 她本人（输密码进来的读者）：能看到盖章和评论框；访客看公开页时没有 */
  reader?: boolean;
}) {
  const tapeTone = pickOf(entry.id, TAPE_TONES);
  const tilt = tiltOf(entry.id, 2);

  if (entry.type === "quote") {
    return (
      <article className="card-paper">
        <WashiTape tone={tapeTone} rotate={tilt > 0 ? -7 : 6} className="-top-3 left-1/4" />
        <div className="mx-auto max-w-sm py-2">
          <StickyNote
            text={entry.body}
            speaker={entry.speaker}
            date={entry.entry_date}
            tilt={tilt}
            tone={pickOf(entry.id, NOTE_TONES)}
          />
        </div>
        {author && <EditLink id={entry.id} />}
      </article>
    );
  }

  if (entry.type === "letter") {
    // 手账流里信只露摘要，去信箱拆开
    return (
      <article className="card-paper flex flex-wrap items-center gap-4">
        <WashiTape tone={tapeTone} rotate={tilt > 0 ? -7 : 6} className="-top-3 left-10" />
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-rose-soft text-rose-deep">
          <EnvelopeSimple weight="fill" className="size-5 -rotate-6" />
        </span>
        <div className="min-w-0 flex-1">
          <DateStamp date={entry.entry_date} />
          <p className="mt-2 truncate font-bold">{entry.title ?? "一封信"}</p>
        </div>
        <Link href="/letters" className="btn-ghost px-4 py-2 text-sm">
          去信箱拆开
        </Link>
        {author && <EditLink id={entry.id} />}
      </article>
    );
  }

  if (entry.type === "board") {
    // 自由拼贴页：整页画布就是内容
    return (
      <article className="card-paper">
        <WashiTape tone={tapeTone} rotate={tilt > 0 ? -7 : 6} className="-top-3 left-10" />
        <header className="flex items-start justify-between gap-4 pr-8">
          <div>
            {entry.title && <h3 className="text-2xl font-bold leading-snug">{entry.title}</h3>}
            <DateStamp date={entry.entry_date} className="mt-2" />
          </div>
        </header>
        <div className="mt-4">
          <BoardZoom layout={entry.layout} />
        </div>
        {reader && !compact && (
          <CommentBox entryId={entry.id} heading="在这页写句话" placeholder="看完这页拼贴，想说点什么" compact />
        )}
        {author && <EditLink id={entry.id} />}
      </article>
    );
  }

  const media = compact ? entry.media.slice(0, 3) : entry.media;

  return (
    <article className="card-paper">
      <WashiTape tone={tapeTone} rotate={tilt > 0 ? -7 : 6} className="-top-3 left-10" />
      <header className="flex items-start justify-between gap-4 pr-8">
        <div>
          {entry.title && <h3 className="text-2xl font-bold leading-snug">{entry.title}</h3>}
          <DateStamp date={entry.entry_date} className="mt-2" />
        </div>
        {entry.mood && isStickerName(entry.mood) && (
          <Sticker name={entry.mood} className="size-9 -rotate-6 text-rose/80" />
        )}
      </header>

      {entry.body && (
        <div className={cn("mt-4 space-y-3 text-[1.05rem]", compact && "line-clamp-4")}>
          <EntryText text={entry.body} />
        </div>
      )}

      {media.length > 0 && <JournalMediaGrid media={media} entryDate={entry.entry_date} tone={tapeTone} author={author} />}

      {!compact && (
        <footer className="mt-6 flex justify-end">
          {reader && <SeenStamp entryId={entry.id} seenAt={seenAt} />}
        </footer>
      )}
      {reader && !compact && entry.type === "journal" && (
        <CommentBox entryId={entry.id} heading="在这页写句话" placeholder="看完这一页，想说点什么" compact />
      )}

      {author && <EditLink id={entry.id} />}
    </article>
  );
}

function EditLink({ id }: { id: string }) {
  return (
    <Link
      href={`/write?edit=${id}`}
      aria-label="编辑这一页"
      title="编辑这一页"
      className="absolute right-4 top-4 grid size-8 place-items-center rounded-full text-ink-soft/60 transition hover:bg-ink/5 hover:text-ink"
    >
      <PencilSimple className="size-4" />
    </Link>
  );
}
