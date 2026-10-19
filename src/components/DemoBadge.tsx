"use client";

import { useState } from "react";
import { Plant } from "@phosphor-icons/react";

/** 演示站角标：公开 demo 部署时由根布局渲染（NEXT_PUBLIC_DEMO_MODE=1）。
 *  收起时只是左下角一颗小胶囊，点开告诉你：内容是样例、会定时重置、
 *  解锁密码和作者口令是多少——不然访客进不了门 */
export function DemoBadge({
  resetMinutes,
  readerPassword,
  authorPassword,
}: {
  resetMinutes: number;
  readerPassword: string;
  authorPassword: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-3 left-3 z-50 max-w-[calc(100vw-1.5rem)]">
      {open && (
        <div className="card-paper mb-2 w-72 px-4 py-4 text-sm leading-relaxed shadow-lg">
          <p className="font-bold">这是公开演示站 🌱</p>
          <p className="mt-2 text-ink-soft">
            手账里的内容都是样例。你写的、传的任何东西都只是演示：内容每 {resetMinutes} 分钟自动重置，
            上传的照片 / 视频 / 语音会换成内置的样例素材，不会真的保存。
          </p>
          <p className="mt-2 text-ink-soft">可以随便玩：解锁、写作、盖章、回话、拆彩蛋都试试。</p>
          <dl className="mt-3 space-y-1.5 rounded-xl bg-butter/40 px-3 py-2.5">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-soft">解锁密码</dt>
              <dd className="font-script text-base font-bold tracking-widest">{readerPassword}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-soft">作者口令（/write）</dt>
              <dd className="font-script text-base font-bold tracking-widest">{authorPassword}</dd>
            </div>
          </dl>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-paper/90 px-3.5 py-2 text-xs font-bold text-ink-soft shadow backdrop-blur transition hover:text-ink"
      >
        <Plant weight="fill" className="size-3.5 text-matcha" />
        演示站{open ? "·收起" : "·密码在这"}
      </button>
    </div>
  );
}
