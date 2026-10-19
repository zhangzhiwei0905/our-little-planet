import Link from "next/link";
import { ArrowRight, Images, Lock } from "@phosphor-icons/react/dist/ssr";
import { getSettings, sectionVisibility, type SectionKey } from "@/lib/settings";
import { listEntries, listPhotos, listAlbum, countPhotos } from "@/lib/entries";
import { findMemory } from "@/lib/memories";
import { isAuthor, isReader } from "@/lib/auth";
import { hashCode, pickOf, tiltOf } from "@/lib/tilt";
import { DayCounter } from "@/components/home/DayCounter";
import { HomeHero, type HeroQuote } from "@/components/home/HomeHero";
import { MemoryCard } from "@/components/home/MemoryCard";
import { AnniversaryCalendar } from "@/components/home/AnniversaryCalendar";
import { MonthSettlement, type MonthStats } from "@/components/home/MonthSettlement";
import { NightSky } from "@/components/home/NightSky";
import { ScribbleTitle } from "@/components/home/ScribbleTitle";
import { SnapRail } from "@/components/home/SnapRail";
import { TimeGreeting } from "@/components/home/TimeGreeting";
import { PolaroidCard } from "@/components/journal/PolaroidCard";
import { Sticker } from "@/components/journal/Sticker";
import { DoodleDivider } from "@/components/journal/DoodleDivider";
import { JournalEntryCard } from "@/components/journal/JournalEntryCard";
import { Reveal } from "@/components/Reveal";
import { recordGuestVisitFor } from "@/lib/visitors";
import { READER_NAME } from "@/lib/reader";

/** 洗牌：首页大拍立得和语录便利贴每次进来都随机翻牌 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SECTION_LINKS: { key: SectionKey; href: string; label: string }[] = [
  { key: "journal", href: "/journal", label: "手账" },
  { key: "album", href: "/album", label: "相册" },
  { key: "quotes", href: "/quotes", label: "语录" },
  { key: "letters", href: "/letters", label: "信箱" },
  { key: "timeline", href: "/timeline", label: "大事记" },
  { key: "screenings", href: "/screenings", label: "放映室" },
];

/** 访客的落地页：首页没公开时，给一间小小的客厅——一句欢迎话、
 *  公开的栏目门牌、和一扇只有她能开的门 */
function GuestLanding({ settings, sections }: { settings: ReturnType<typeof getSettings>; sections: Record<SectionKey, boolean> }) {
  const openSections = SECTION_LINKS.filter((s) => sections[s.key]);
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center py-16 text-center">
      <NightSky />
      <p className="font-script text-2xl text-rose-deep">{settings.names} 的手账</p>
      <ScribbleTitle title={settings.title} />
      <p className="mt-8 max-w-md text-ink-soft">
        {settings.guestWelcome?.trim() || "欢迎来我们的小星球做客。这里有一小部分摊开给你看，其余的，是我们俩的悄悄话"}
      </p>
      {openSections.length > 0 && (
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {openSections.map((s) => (
            <Link key={s.key} href={s.href} className="btn-ghost">
              {s.label}
              <ArrowRight weight="bold" className="size-3.5" />
            </Link>
          ))}
        </div>
      )}
      <DoodleDivider variant="hearts" className="mt-12 w-28" />
      <Link href="/lock" className="btn-primary mt-10">
        <Lock weight="bold" className="size-4" />
        {READER_NAME}的专属入口
      </Link>
      <p className="mt-4 font-script text-xl text-ink-soft/60">psst. 有密码的人才进得去</p>
    </div>
  );
}

export default async function HomePage() {
  await recordGuestVisitFor("/");
  const [settings, author, reader] = [getSettings(), await isAuthor(), await isReader()];
  const sections = sectionVisibility(settings);
  // 首页没对访客公开：给落地页
  if (!reader && !sections.home) return <GuestLanding settings={settings} sections={sections} />;
  const guest = !reader;

  // 「最近的一页」只看手账内容（手账页/自由拼贴页）；语录单独取最新的那句。
  // 访客只看公开内容
  const latestEntry = listEntries({ excludeTypes: ["photo", "quote", "letter"], limit: 1, guest })[0];
  const photos = listPhotos({ guest }).slice(0, 8);
  const photoTotal = countPhotos({ guest });
  // 大拍立得 + 便利贴语录：随机翻牌，客户端每 5 秒再换（HomeHero 里轮换）
  const heroPool = shuffle(listPhotos({ guest }));
  const quotePool: HeroQuote[] = shuffle(
    listEntries({ type: "quote", limit: 200, guest }).map((q) => ({ id: q.id, body: q.body, speaker: q.speaker }))
  );
  // 「这本本子记得」：从过去月份的同一天前后翻一张旧日子出来（信不参与，它们住在信箱里）
  const memory = findMemory(listEntries({ excludeTypes: ["letter"], guest }));

  // 「本月我们」结算单：当前月份的实时统计（金句按月哈希挑一句，月内不变）
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthEntries = listEntries({ guest }).filter((e) => e.entry_date.startsWith(monthKey));
  const monthAlbum = listAlbum({ guest }).filter((p) => p.entryDate.startsWith(monthKey));
  const monthQuotes = monthEntries.filter((e) => e.type === "quote");
  const quoteOfMonth = monthQuotes.length > 0 ? monthQuotes[hashCode(monthKey) % monthQuotes.length] : null;
  const monthStats: MonthStats = {
    monthKey,
    photos: monthAlbum.filter((p) => p.kind === "photo").length,
    videos: monthAlbum.filter((p) => p.kind === "video").length,
    pages: monthEntries.filter((e) => e.type === "journal" || e.type === "board").length,
    quotes: monthQuotes.length,
    letters: monthEntries.filter((e) => e.type === "letter").length,
    quote: quoteOfMonth ? { body: quoteOfMonth.body, speaker: quoteOfMonth.speaker } : null,
  };

  return (
    <div className="py-8 sm:py-12">
      {/* 摊开的第一页 */}
      <section className="relative grid items-center gap-14 py-8 sm:py-12 lg:min-h-[calc(100dvh-14rem)] lg:grid-cols-[1.05fr_0.95fr]">
        <NightSky />
        <div>
          <p className="font-script text-2xl text-rose-deep">{settings.names} 的手账</p>
          <ScribbleTitle title={settings.title} />
          <DayCounter startDate={settings.startDate} className="mt-10" />
          <TimeGreeting startDate={settings.startDate} className="mt-4" />
          <div className="mt-10 flex flex-wrap items-center gap-4">
            {sections.album && (
              <Link href="/album" className="btn-primary">
                <Images weight="fill" className="size-5" />
                翻翻相册
              </Link>
            )}
            {sections.journal && (
              <Link href="/journal" className="btn-ghost">
                看看手账
                <ArrowRight weight="bold" className="size-4" />
              </Link>
            )}
          </div>
        </div>

        <HomeHero photos={heroPool} quotes={quotePool} author={author} />
      </section>

      {/* 这本本子记得：N 个月前的今天 */}
      {memory && (
        <Reveal>
          <MemoryCard memory={memory} />
        </Reveal>
      )}

      {/* 最近的一页 */}
      <section className="mt-16 py-8">
        <div className="mb-7 flex items-end justify-between gap-4">
          <h2 className="text-3xl font-bold">最近的一页</h2>
          {sections.journal && (
            <Link href="/journal" className="link-soft text-sm">
              翻遍整本
              <ArrowRight weight="bold" className="size-3.5" />
            </Link>
          )}
        </div>
        {latestEntry ? (
          <Reveal>
            <JournalEntryCard entry={latestEntry} author={author} reader={reader} compact />
          </Reveal>
        ) : (
          <div className="card-paper flex flex-col items-center gap-4 py-14 text-center">
            <Sticker name="cloud" className="size-12 text-mist" />
            <p className="text-ink-soft">{reader ? "这本手账还是崭新的，第一页在等你写下" : "能给你看的页面还在准备中"}</p>
            {author && (
              <Link href="/write?type=journal" className="btn-primary">
                去记第一页
              </Link>
            )}
          </div>
        )}
      </section>

      {/* 最近贴上的拍立得 */}
      {photos.length > 0 && (
        <section className="mt-8 py-8">
          <div className="mb-7 flex items-end justify-between gap-4">
            <h2 className="text-3xl font-bold">最近贴上的拍立得</h2>
            <p className="font-round text-sm tracking-wider text-ink-soft">
              共 {photoTotal} 张
            </p>
          </div>
          <SnapRail>
            {photos.map((p) => (
              <div key={p.id} className="w-40 shrink-0 snap-start sm:w-48">
                <PolaroidCard
                  src={p.thumbUrl ?? p.url}
                  caption={p.caption}
                  alt={p.caption ?? "我们的照片"}
                  tilt={tiltOf(p.id)}
                  tone={pickOf(p.id, ["rose", "butter", "mist", "peach", "matcha"])}
                  tape="none"
                  width={p.width}
                  height={p.height}
                  liveVideo={p.liveVideo}
                />
              </div>
            ))}
          </SnapRail>
          <DoodleDivider variant="wave" className="mx-auto" />
        </section>
      )}

      {/* 重要的日子：整百天 / 520 / 1314 / 周年 + 情人节、七夕这些记号 */}
      <Reveal>
        <AnniversaryCalendar startDate={settings.startDate} today={today} />
      </Reveal>

      {/* 「本月我们」结算单 */}
      <Reveal>
        <MonthSettlement stats={monthStats} />
      </Reveal>
    </div>
  );
}
