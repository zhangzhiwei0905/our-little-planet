import type { Metadata } from "next";
import Link from "next/link";
import { isAuthor, isReader } from "@/lib/auth";
import { getSettings, sectionOpen } from "@/lib/settings";
import { listMilestones } from "@/lib/milestones";
import { countQuotes } from "@/lib/entries";
import { getMediaById, publicMedia } from "@/lib/media";
import { TimelineList } from "@/components/timeline/TimelineList";
import { TimelineIntro } from "@/components/timeline/TimelineIntro";
import { SeasonSettlement } from "@/components/timeline/SeasonSettlement";
import { BgmPlayer } from "@/components/timeline/BgmPlayer";
import { DoodleDivider } from "@/components/journal/DoodleDivider";
import { Sticker } from "@/components/journal/Sticker";
import { AddEntryButton } from "@/components/AddEntryButton";
import { GuestLock } from "@/components/GuestLock";
import { recordGuestVisitFor } from "@/lib/visitors";

export const metadata: Metadata = { title: "大事记" };

function daysBetween(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00`).getTime();
  const b = new Date(`${end}T00:00:00`).getTime();
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

export default async function TimelinePage() {
  await recordGuestVisitFor("/timeline");
  const [reader, author, settings] = [await isReader(), await isAuthor(), getSettings()];
  if (!reader && !sectionOpen(settings, "timeline")) return <GuestLock section="大事记" />;
  // 访客只看标了「公开」的里程碑
  const milestones = listMilestones({ guest: !reader });
  const today = new Date().toLocaleDateString("en-CA");
  const hasStart = /^\d{4}-\d{2}-\d{2}$/.test(settings.startDate ?? "");
  // 背景音乐：配置了音频才挂播放器；OSS 模式下走短时签名地址，和里程碑照片同一待遇
  const bgmRow = settings.bgmMediaId ? getMediaById(settings.bgmMediaId) : undefined;
  const bgm = bgmRow && bgmRow.kind === "audio" ? publicMedia(bgmRow, { direct: true }) : null;
  // 结算单和片头要的数字：集数、天数、名场面镜头、金句，全是库里现成的
  const days = hasStart ? daysBetween(settings.startDate!, today) : null;
  const shots = milestones.reduce((n, m) => n + m.media.length, 0);
  const quotes = countQuotes(!reader);
  const season = days !== null ? Math.floor(days / 365) + 1 : null;

  return (
    <div className="py-10">
      <TimelineIntro season={season} eps={milestones.length} />
      <header className="text-center">
        <h1 className="text-4xl font-bold">大事记</h1>
        <p className="mt-3 text-ink-soft">从我们开始的那天起，一路往下走</p>
        <DoodleDivider variant="wave" className="mx-auto mt-6" />
        {author && (
          <div className="mt-6">
            <AddEntryButton href="/write?type=milestone" icon="milestone" label="记一件大事" />
          </div>
        )}
        {hasStart && (
          <p className="mt-6 font-script text-2xl text-ink-soft/80">
            day 0 to day {daysBetween(settings.startDate, today)}
            {milestones.length > 0 && ` · ${milestones.length} 个值得记住的时刻`}
          </p>
        )}
      </header>

      {!hasStart && milestones.length === 0 ? (
        <div className="card-paper mx-auto mt-16 flex max-w-md flex-col items-center gap-4 py-14 text-center">
          <Sticker name="star" className="size-12 text-butter" />
          <p className="text-ink-soft">时间线还是一条空白的胶带，等第一件大事</p>
          {author && (
            <Link href="/write?type=milestone" className="btn-primary">
              去录第一件大事
            </Link>
          )}
        </div>
      ) : (
        // Keep the unbounded timeline visible without a viewport-percentage animation.
        <TimelineList milestones={milestones} startDate={hasStart ? settings.startDate : null} author={author} />
      )}
      {(milestones.length > 0 || hasStart) && (
        <SeasonSettlement eps={milestones.length} days={days} shots={shots} quotes={quotes} hasStart={hasStart} />
      )}
      {/* 背景音乐文件在读者锁后面，访客就不挂播放器了 */}
      {reader && bgm && <BgmPlayer src={bgm.url} title={settings.bgmTitle || "我们的歌"} lyrics={settings.bgmLyrics} />}
    </div>
  );
}
