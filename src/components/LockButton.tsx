"use client";

import { useState } from "react";
import { Lock } from "@phosphor-icons/react";
import { BookFlip } from "@/components/lock/BookFlip";

/** 合上本子：全屏演一段「合上封面」，再清掉解锁 cookie 回到锁页 */
export function LockButton() {
  const [closing, setClosing] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={closing}
        onClick={() => setClosing(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink/20 px-4 py-1.5 text-sm font-bold text-ink-soft transition hover:bg-ink/5 hover:text-ink"
      >
        <Lock className="size-3.5" />
        {closing ? "正在合上…" : "合上本子"}
      </button>
      {closing && (
        <BookFlip
          phase="closing"
          onDone={async () => {
            await fetch("/api/lock", { method: "DELETE" }).catch(() => undefined);
            // 清掉 cookie 后全页跳转，确保回到锁住状态
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = "/lock";
          }}
        />
      )}
    </>
  );
}
