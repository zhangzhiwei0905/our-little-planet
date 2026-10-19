"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { MagnifyingGlassPlus, X } from "@phosphor-icons/react";
import { BoardView } from "./BoardView";
import { useMounted } from "@/lib/use-mounted";
import type { BoardLayout } from "@/lib/board";

/** 拼贴页放大查看：点击整页 → 全屏遮罩里看大图，Esc / 点空白关闭 */
export function BoardZoom({ layout }: { layout: BoardLayout | null }) {
  const [open, setOpen] = useState(false);
  // portal 到 body 用：首帧（SSR/hydration）不渲染，挂载后再挂
  const mounted = useMounted();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  // 遮罩 portal 到 body 下：调用方在卡片内部，带 transform 的祖先（Reveal / 倾斜角）
  // 会把 fixed 困在卡片区域里，遮罩跟着卡片歪、点击关闭落空（同 Lightbox 的修法）
  const overlay = (
    <AnimatePresence>
      {open && (
        <motion.div
          key="board-zoom"
          className="fixed inset-0 z-50 overflow-y-auto bg-ink/70 p-4 backdrop-blur-sm sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={() => setOpen(false)}
        >
          <div className="flex min-h-full items-center justify-center py-4" onClick={(e) => e.stopPropagation()}>
            <motion.div
              className="w-full max-w-3xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <BoardView layout={layout} />
            </motion.div>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setOpen(false)}
            className="fixed right-4 top-4 grid size-11 place-items-center rounded-full bg-paper/15 text-paper backdrop-blur transition hover:bg-paper/30"
          >
            <X weight="bold" className="size-5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group relative block w-full cursor-zoom-in" aria-label="放大看这一页">
        <BoardView layout={layout} />
        <span className="absolute bottom-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-ink/45 text-paper opacity-0 backdrop-blur transition group-hover:opacity-100">
          <MagnifyingGlassPlus weight="bold" className="size-4" />
        </span>
      </button>

      {mounted && createPortal(overlay, document.body)}
    </>
  );
}
