import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isReader } from "@/lib/auth";
import { listArrivedEggs, migrateLegacySomeday } from "@/lib/eggs";
import { DoodleDivider } from "@/components/journal/DoodleDivider";
import { Sticker } from "@/components/journal/Sticker";
import { Gift } from "@phosphor-icons/react/dist/ssr";
import { recordGuestVisitFor } from "@/lib/visitors";

export const metadata: Metadata = { title: "Someday" };

/** 隐藏彩蛋列表：只显示已到揭晓日期的（未到期的一个都不露） */
export default async function SomedayPage() {
  await recordGuestVisitFor("/someday");
  if (!(await isReader())) redirect("/lock?next=/someday");
  migrateLegacySomeday();
  const eggs = listArrivedEggs();

  if (eggs.length === 0) {
    return (
      <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-16 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <Sticker name="cloud" className="absolute left-[12%] top-[16%] size-12 rotate-3 text-mist/50" />
          <Sticker name="star" className="absolute right-[14%] top-[24%] size-8 -rotate-12 text-butter/60" />
          <Sticker name="heart" className="absolute bottom-[18%] right-[18%] size-9 rotate-6 text-rose/40" />
        </div>
        <div className="card-paper max-w-sm px-8 py-12">
          <h1 className="text-2xl font-bold">还没到打开的时候</h1>
          <p className="mt-4 leading-relaxed text-ink-soft">这一页藏着一些礼物，它们在等各自的日子。</p>
          <DoodleDivider variant="wave" className="mx-auto mt-8" />
          <p className="mt-6 font-script text-2xl text-ink-soft/70">come back someday</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-16">
      <div className="mb-12 text-center">
        <p className="font-script text-3xl text-rose-deep">the day has come</p>
        <h1 className="mt-3 text-4xl font-bold">这里藏着 {eggs.length} 份礼物</h1>
        <p className="mt-3 text-ink-soft">每一份都在等你输入它的密码</p>
      </div>
      <div className="grid w-full max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2">
        {eggs.map((egg) => (
          <div key={egg.id} className="card-paper flex items-center gap-4 px-6 py-5">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-rose-soft text-rose-deep">
              <Gift weight="fill" className="size-5 -rotate-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold">{egg.title}</p>
              <p className="mt-1 font-round text-xs tracking-widest text-ink-soft">
                {egg.revealDate.replaceAll("-", ".")}
                {egg.photoCount > 0 && ` · ${egg.photoCount} 张照片`}
              </p>
            </div>
            <Link href={`/someday/${egg.id}`} className="btn-primary shrink-0 px-4 py-2 text-sm">
              拆开
            </Link>
          </div>
        ))}
      </div>
    </main>
  );
}
