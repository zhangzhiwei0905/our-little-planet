"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

function stampLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/** 已阅印章：没盖时是一枚淡淡的虚线章「看过就盖个章」，点一下「啪」地盖实——
 *  红墨小圆章，微微歪斜，像真的按在纸上。每页只有一枚，盖过就一直在 */
export function SeenStamp({ entryId, seenAt, className }: { entryId: string; seenAt: string | null; className?: string }) {
  const [seen, setSeen] = useState<string | null>(seenAt);
  const [busy, setBusy] = useState(false);
  const reduce = useReducedMotion();

  async function stamp() {
    if (busy || seen) return;
    setBusy(true);
    try {
      const res = await fetch("/api/marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, kind: "seen" }),
      });
      const data = (await res.json().catch(() => ({}))) as { createdAt?: string };
      if (res.ok && data.createdAt) setSeen(data.createdAt);
    } finally {
      setBusy(false);
    }
  }

  if (seen) {
    return (
      <motion.span
        aria-label={`她看过啦，${stampLabel(seen)}`}
        initial={reduce ? false : { scale: 1.8, opacity: 0, rotate: 20 }}
        animate={{ scale: 1, opacity: 1, rotate: 9 }}
        transition={{ type: "spring", stiffness: 320, damping: 15 }}
        className={cn(
          "stamp-blend inline-flex select-none flex-col items-center justify-center rounded-full border-2 border-rose-deep/60 px-3 py-1.5",
          "font-round text-[11px] font-bold leading-tight tracking-widest text-rose-deep/85",
          className
        )}
        style={{ background: "color-mix(in srgb, var(--color-rose-deep) 6%, transparent)" }}
      >
        <span>她看过啦</span>
        <span className="text-[10px] opacity-75">{stampLabel(seen)}</span>
      </motion.span>
    );
  }

  return (
    <button
      type="button"
      onClick={stamp}
      disabled={busy}
      className={cn(
        "inline-flex rotate-3 select-none items-center rounded-full border-2 border-dashed border-ink/25 px-3 py-1.5",
        "font-round text-[11px] font-bold tracking-widest text-ink-soft/60 transition",
        "hover:border-rose/60 hover:text-rose-deep/80 disabled:opacity-50",
        className
      )}
    >
      {busy ? "盖章中…" : "看过就盖个章"}
    </button>
  );
}
