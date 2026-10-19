import { FlagBanner, Paperclip } from "@phosphor-icons/react/dist/ssr";
import type { Milestone } from "@/lib/milestones";
import { DateStamp } from "@/components/journal/DateStamp";
import { MilestoneMedia } from "./MilestoneMedia";
import { Sticker } from "@/components/journal/Sticker";
import { Stamp } from "./Stamp";
import { WashiTape } from "@/components/journal/WashiTape";
import { EpisodeChip, GradeStamp, gradeOf } from "./EpisodeStamp";
import { NOTE_TONES, NOTE_COLORS, pickOf, tiltOf } from "@/lib/tilt";
import { cn } from "@/lib/cn";

/** 麻绳：竖着贯穿整页的微垂波浪线（拉满高度），代替原来笔直的胶带中轴 */
function Rope({ className }: { className?: string }) {
  return (
    <svg aria-hidden preserveAspectRatio="none" viewBox="0 0 24 600" className={cn("pointer-events-none h-full w-6 text-ink/30", className)}>
      <path
        d="M12 0 C 8 40, 16 80, 12 120 C 8 160, 16 200, 12 240 C 8 280, 16 320, 12 360 C 8 400, 16 440, 12 480 C 8 520, 16 560, 12 600"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 挂绳：从麻绳到小夹子的短短一截下垂弧线（像照片被夹子吊着） */
function DropRope({ flip }: { flip?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 56 26"
      className={cn("pointer-events-none h-6 w-14 text-ink/30", flip && "-scale-x-100")}
    >
      <path d="M2 4 C 18 22, 38 20, 52 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="0.5 4" />
    </svg>
  );
}

/** 小夹子 + 挂绳：夹子咬在内容顶部，绳子那头搭在麻绳上 */
function Clip({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute -top-3.5 z-10 flex items-center text-rose-deep/80",
        side === "left" ? "right-[-3.25rem] hidden sm:flex" : "left-[-3.25rem] hidden sm:flex",
        // 移动端：麻绳在左边缘，挂绳缩短朝左
        side === "left" && "max-sm:right-auto max-sm:left-[-1.6rem] max-sm:flex",
        side === "right" && "max-sm:left-[-1.6rem] max-sm:flex"
      )}
    >
      <DropRope flip={side === "left"} />
      <Paperclip weight="fill" className="size-5 -rotate-12 drop-shadow-sm" />
    </span>
  );
}

/** 随手一贴的倾斜角 → 静态类名。不能内联 style 设 transform，
 *  否则优先级永远压过 hover:rotate-0，悬停回正就不生效了 */
const TILT_CLASS: Record<number, string> = {
  [-3]: "-rotate-3",
  [-2]: "-rotate-2",
  [-1]: "-rotate-1",
  0: "",
  1: "rotate-1",
  2: "rotate-2",
  3: "rotate-3",
};

/** 一件大事 = 挂在麻绳上的「拍立得 + 便利贴」小簇：
 *  没有卡片盒子，照片是拍立得，文字写在便利贴上（和纸胶带贴角 + 随手一贴的倾斜），
 *  图标贴纸压在便利贴角落，日期是盖上去的章 */
function HangingCluster({ m, i, author }: { m: Milestone; i: number; author?: boolean }) {
  const tone = pickOf(m.id, NOTE_TONES);
  const tilt = tiltOf(m.id, 3);
  const side = i % 2 === 0 ? "left" : "right";
  const ep = i + 1;
  return (
    <div
      className={cn(
        "relative origin-top transition-transform duration-500 ease-spring hover:rotate-0",
        TILT_CLASS[tilt],
        side === "left" ? "sm:col-start-1 sm:justify-self-end" : "sm:col-start-2"
      )}
    >
      <Clip side={side} />
      <div className={cn("relative flex w-full max-w-sm flex-col gap-3 pl-6 sm:max-w-none sm:pl-0")}>
        {/* 文案在上：便利贴先写，照片垫在下面；对齐偏向麻绳那侧，让夹子咬住便利贴的顶角 */}
        <div
          className={cn(
            "sticky-note relative self-start px-4 pt-4 pb-3.5",
            side === "left" && "sm:self-end"
          )}
          style={{ "--tone": NOTE_COLORS[tone] } as React.CSSProperties}
        >
          <WashiTape tone={tone === "butter" ? "butter" : "rose"} rotate={tilt > 0 ? -6 : 5} className="-top-2 left-1/2 scale-[0.6]" />
          <GradeStamp grade={gradeOf(m.id, m.media.length, m.body.length)} />
          <div className="flex flex-wrap items-center gap-2">
            <EpisodeChip ep={ep} />
            <DateStamp date={m.date} />
          </div>
          <p className="mt-1 font-script text-2xl leading-tight text-ink">{m.title}</p>
          {m.body && <p className="mt-1 whitespace-pre-line font-hand text-sm leading-relaxed text-ink-soft">{m.body}</p>}
          {m.icon && m.media.length > 0 && (
            <span className="absolute -bottom-2.5 -left-2.5 grid size-9 -rotate-6 place-items-center rounded-full bg-paper shadow-card">
              <Sticker name={m.icon} className="size-6" />
            </span>
          )}
        </div>
        <div className="relative">
          {m.media.length > 0 && <MilestoneMedia media={m.media} entryDate={m.date} tone="rose" author={author} />}
          {m.media.length === 0 && (
            // 没配照片的大事：图标贴纸直接当主视觉，别空着
            <span className="grid h-24 place-items-center">
              {m.icon ? (
                <Sticker name={m.icon} className="size-16" />
              ) : (
                <FlagBanner weight="fill" className="size-8 text-ink/50" />
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** 大事记时间轴：一根微垂的麻绳从「我们开始的那天」延伸下来，
 *  每件大事用小夹子挂在绳上，左右交错、随手一贴的角度，滚动看下去像一墙晾着的回忆 */
export function TimelineList({
  milestones,
  startDate,
  author = false,
}: {
  milestones: Milestone[];
  startDate: string | null;
  author?: boolean;
}) {
  return (
    <div className="relative mt-16">
      {/* 麻绳主轴：桌面居中，移动端靠左 */}
      <div aria-hidden className="absolute bottom-0 left-[9px] top-0 w-6 sm:left-1/2 sm:-translate-x-1/2">
        <Rope className="h-full" />
      </div>

      <ol className="space-y-20">
        {startDate && (
          <li className="relative pl-10 sm:grid sm:grid-cols-2 sm:gap-28 sm:pl-0">
            {/* 第一枚邮票：麻绳的起点，我们的开始 */}
            <div className="sm:col-start-1 sm:justify-self-end">
              <Stamp className="mx-auto w-fit max-w-full">
                <div className="w-64 max-w-full px-3 py-4 text-center sm:w-72">
                  <p className="font-script text-2xl leading-none text-rose-deep">our beginning</p>
                  <p className="mt-1.5 font-round text-xs tracking-[0.25em] text-ink-soft">{startDate.replaceAll("-", ".")}</p>
                  <p className="mt-3 text-xl font-bold">一切的开始</p>
                  <p className="mt-3 font-script text-xl text-rose/80">♥ forever</p>
                </div>
              </Stamp>
            </div>
          </li>
        )}

        {milestones.map((m, i) => (
          <li key={m.id} className="relative pl-10 sm:grid sm:grid-cols-2 sm:gap-28 sm:pl-0">
            <HangingCluster m={m} i={i} author={author} />
          </li>
        ))}
      </ol>
    </div>
  );
}
