import { redirect } from "next/navigation";
import { isReader } from "@/lib/auth";
import { LockForm } from "@/components/lock/LockForm";
import { Sticker } from "@/components/journal/Sticker";
import { ThemeToggle } from "@/components/ThemeToggle";
import { recordGuestVisitFor } from "@/lib/visitors";
import { IS_DEMO } from "@/lib/demo";

export default async function LockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await recordGuestVisitFor("/lock");
  if (await isReader()) redirect("/");
  const { next } = await searchParams;

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-16">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <Sticker name="heart" className="absolute left-[12%] top-[14%] size-10 rotate-[-8deg] text-rose/50" />
        <Sticker name="star" className="absolute right-[15%] top-[20%] size-8 rotate-12 text-butter" />
        <Sticker name="cloud" className="absolute bottom-[16%] left-[18%] size-14 rotate-3 text-mist/70" />
        <Sticker name="flower" className="absolute bottom-[22%] right-[12%] size-12 rotate-[-10deg] text-matcha/80" />
      </div>
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle className="bg-paper/60 backdrop-blur" />
      </div>
      <LockForm next={next} demoHint={IS_DEMO ? `演示站：解锁密码 ${process.env.READER_PASSWORD ?? "0520"}` : undefined} />
    </main>
  );
}
