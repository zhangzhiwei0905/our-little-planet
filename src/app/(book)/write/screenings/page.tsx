import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { isAuthor } from "@/lib/auth";
import { listScreenings } from "@/lib/screenings";
import { listAlbum } from "@/lib/entries";
import { PenGate } from "@/components/write/PenGate";
import { ScreeningManager } from "@/components/screenings/ScreeningManager";
import { recordGuestVisitFor } from "@/lib/visitors";

export const metadata: Metadata = { title: "排片 · 放映室" };

/** 放映室的后台：排一场新首映 / 管理已有的场次 */
export default async function WriteScreeningsPage() {
  await recordGuestVisitFor("/write/screenings");
  if (!(await isAuthor())) return <PenGate />;
  const screenings = listScreenings({ includeUnpublished: true });
  // 「从本子里选」的候选：含孤儿（刚传未保存的），已入册的视频/照片都能选来用
  const album = listAlbum({ includeOrphans: true });

  return (
    <div className="mx-auto max-w-3xl py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">放映室 · 排片</h1>
        <Link href="/screenings" className="link-soft text-sm">
          去放映室看看
          <ArrowLeft weight="bold" className="size-3.5 rotate-180" />
        </Link>
      </header>
      <p className="mt-4 px-1 text-sm leading-relaxed text-ink-soft">
        在别处做好的完整纪念视频，原样传上来、排一个首映日期；也可以直接从本子里选已有的视频。
        没到日子她只能看到挂着的幕布和倒计时；到了那天自动开演，映后她可以盖章、写观后感——你在「她的痕迹」里都看得到。
        放映室专用的视频和封面不会出现在相册里。
      </p>
      <div className="mt-7">
        <ScreeningManager
          initial={screenings}
          album={album.map((p) => ({
            id: p.id,
            url: p.url,
            thumbUrl: p.thumbUrl,
            posterUrl: p.posterUrl,
            caption: p.caption,
            kind: p.kind,
            mime: p.mime,
            width: p.width,
            height: p.height,
            liveVideo: p.liveVideo,
            entryDate: p.entryDate,
          }))}
        />
      </div>
      <Link href="/write" className="link-soft mt-8 text-sm">
        <ArrowLeft weight="bold" className="size-3.5" />
        回到写作后台
      </Link>
    </div>
  );
}
