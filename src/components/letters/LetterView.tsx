"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PencilSimple, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { EntryText } from "@/components/journal/EntryText";
import { WashiTape } from "@/components/journal/WashiTape";
import { SeenStamp } from "@/components/marks/SeenStamp";
import { CommentBox, type ReplyItem } from "@/components/marks/CommentBox";

export type LetterData = {
  id: string;
  title: string | null;
  body: string;
  entryDate: string;
  mood: string | null;
  /** 她的已阅印章日期（ISO）；null/缺省 = 还没盖 */
  seenAt?: string | null;
  /** 她之前寄回来的话（游客看信时为空，评论只属于她） */
  replies?: ReplyItem[];
  /** 她本人（读者）才显示回话框；访客看公开信时没有 */
  reader?: boolean;
};

/** 拆信：信纸从信封里滑出，展开成全屏阅读态 */
export function LetterView({
  letter,
  author,
  onClose,
}: {
  letter: LetterData | null;
  author: boolean;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!letter) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [letter, onClose]);

  return (
    <AnimatePresence>
      {letter && (
        <motion.div
          key="letter-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={onClose}
        >
          <motion.article
            key={letter.id}
            className={cn(
              "letter-paper relative max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-lg px-7 pb-14 pt-10 shadow-lifted sm:px-12"
            )}
            initial={reduce ? false : { y: 80, opacity: 0, scale: 0.96, rotate: -1 }}
            animate={{ y: 0, opacity: 1, scale: 1, rotate: 0 }}
            exit={reduce ? { opacity: 0 } : { y: 60, opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <WashiTape tone="rose" rotate={-5} className="-top-3 left-1/2" />

            <p className="font-script text-3xl leading-none text-rose-deep">
              {letter.entryDate.replaceAll("-", ".")}
            </p>
            <h2 className="mt-3 text-3xl font-bold">{letter.title ?? "写给你"}</h2>

            <div className="mt-8">
              <EntryText text={letter.body} lined />
            </div>

            <footer className="mt-10 flex items-end justify-between gap-4">
              {letter.reader !== false && <SeenStamp entryId={letter.id} seenAt={letter.seenAt ?? null} />}
              <p className="font-script text-3xl text-ink/85">always yours</p>
            </footer>

            {letter.reader !== false && <CommentBox entryId={letter.id} initial={letter.replies ?? []} />}

            <button
              type="button"
              aria-label="折好放回"
              onClick={onClose}
              className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-ink-soft/60 transition hover:bg-ink/10 hover:text-ink"
            >
              <X weight="bold" className="size-4" />
            </button>
            {author && (
              <Link
                href={`/write?edit=${letter.id}`}
                aria-label="编辑这封信"
                title="编辑这封信"
                className="absolute left-3 top-3 grid size-9 place-items-center rounded-full text-ink-soft/60 transition hover:bg-ink/10 hover:text-ink"
              >
                <PencilSimple className="size-4" />
              </Link>
            )}
          </motion.article>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
