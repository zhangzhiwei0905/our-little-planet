import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ChatTeardropText, EnvelopeSimple, Notebook } from "@phosphor-icons/react/dist/ssr";
import { isAuthor } from "@/lib/auth";
import { recordGuestVisitFor } from "@/lib/visitors";
import { listReplies, listSeens } from "@/lib/marks";
import { PenGate } from "@/components/write/PenGate";
import { DoodleDivider } from "@/components/journal/DoodleDivider";
import { Sticker } from "@/components/journal/Sticker";

export const metadata: Metadata = { title: "她的痕迹" };

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function entryLabel(type: string, title: string | null): string {
  if (type === "letter") return `信《${title ?? "写给你"}》`;
  if (type === "journal") return title ? `手账页《${title}》` : "一页手账";
  if (type === "quote") return "一张便利贴";
  if (type === "board") return title ? `自由页《${title}》` : "一页自由拼贴";
  if (type === "screening") return `放映《${title ?? "一场首映"}》`;
  return "一页";
}

function entryHref(type: string, entryId: string, entryDate: string): string {
  if (type === "letter") return "/letters";
  if (type === "screening") return "/screenings";
  return `/journal?date=${entryDate}`;
}

/** 她的痕迹：她盖过的已阅印章、页脚寄回来的评论（文字/表情/图），只有作者能进这一页 */
export default async function MarksPage() {
  await recordGuestVisitFor("/write/marks");
  if (!(await isAuthor())) return <PenGate />;
  const [replies, seens] = [listReplies(), listSeens()];

  return (
    <div className="py-10">
      <header className="text-center">
        <p className="font-script text-2xl text-rose-deep">only for you</p>
        <h1 className="mt-2 text-4xl font-bold">她的痕迹</h1>
        <p className="mt-3 text-ink-soft">她盖过的章、写下的评论和配的图，都收在这儿</p>
        <DoodleDivider variant="hearts" className="mx-auto mt-6 w-28" />
        <Link href="/write" className="link-soft mt-5 text-sm">
          <ArrowLeft weight="bold" className="size-3.5" />
          回到写作后台
        </Link>
      </header>

      <div className="mx-auto mt-12 grid max-w-4xl gap-8 lg:grid-cols-2">
        {/* 评论 */}
        <section className="card-paper">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <ChatTeardropText weight="fill" className="size-5 text-rose-deep/70" />
            寄回来的话
            <span className="ml-auto font-round text-sm font-bold tracking-widest text-ink-soft">{replies.length} 条</span>
          </h2>
          {replies.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Sticker name="cloud" className="size-10 text-mist" />
              <p className="text-sm text-ink-soft">还没有评论。她读完信或手账页，就会寄一句回来</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-4">
              {replies.map((r) => (
                <li key={r.id} className="rounded-2xl bg-rose-soft/70 px-4 py-3">
                  {r.body && <p className="whitespace-pre-wrap leading-relaxed">{r.body}</p>}
                  {r.media.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.media.map((m) => (
                        <a key={m.id} href={m.url} target="_blank" rel="noreferrer" aria-label="放大看这张" className="block transition hover:opacity-85">
                          {/* eslint-disable-next-line @next/next/no-img-element -- 评论图走带鉴权的 /api/media */}
                          <img src={m.thumbUrl ?? m.url} alt="" loading="lazy" className="max-h-24 rounded-lg object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 font-round text-[11px] tracking-wider text-ink-soft">
                    <EnvelopeSimple weight="fill" className="size-3.5 text-rose-deep/60" />
                    <Link href={entryHref(r.entryType, r.entryId, r.entryDate)} className="font-bold text-rose-deep hover:opacity-75">
                      {entryLabel(r.entryType, r.entryTitle)}
                    </Link>
                    <span className="opacity-60">·</span>
                    <span>{fmt(r.createdAt)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 印章 */}
        <section className="card-paper">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Notebook weight="fill" className="size-5 text-rose-deep/70" />
            盖过的章
            <span className="ml-auto font-round text-sm font-bold tracking-widest text-ink-soft">{seens.length} 枚</span>
          </h2>
          {seens.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Sticker name="heart" className="size-10 text-rose/70" />
              <p className="text-sm text-ink-soft">还没有印章。她翻到页末点一下「看过就盖个章」就有了</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {seens.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-xl border border-ink/8 px-4 py-2.5">
                  <span className="inline-flex shrink-0 rotate-3 items-center rounded-full border-2 border-rose-deep/50 px-2.5 py-0.5 font-round text-[10px] font-bold tracking-widest text-rose-deep/80">
                    已阅
                  </span>
                  <Link
                    href={entryHref(s.entryType, s.entryId, s.entryDate)}
                    className="min-w-0 flex-1 truncate font-bold text-ink hover:text-rose-deep"
                  >
                    {entryLabel(s.entryType, s.entryTitle)}
                  </Link>
                  <span className="shrink-0 font-round text-[11px] tracking-wider text-ink-soft">{fmt(s.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
