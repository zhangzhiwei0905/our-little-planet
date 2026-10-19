"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Image as ImageIcon, PaperPlaneTilt, Smiley, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

export type MarkMedia = { id: string; url: string; thumbUrl: string | null; width: number | null; height: number | null };
export type ReplyItem = { body: string; createdAt: string; media: MarkMedia[] };

const MAX_BODY = 300;
const MAX_IMAGES = 3;

/** 表情面板：挑了一排她最可能用的（脸、爱心、小动物、吃的），点一下插到光标处 */
const EMOJIS = [
  "😂","🥰","😍","😘","🤗","🥺","😭","😤","🤔","😴","🤤","🙄",
  "😅","🙃","😋","😏","🤫","🤭","😬","😳","🥵","🥱","😱","🤯",
  "👍","🤞","✌️","🫶","👏","🙏","💪","🤙","👌","🙈","🙉","🙊",
  "❤️","🧡","💛","💚","💙","💜","🖤","💕","💖","💗","💞","💔",
  "✨","⭐","🌙","☀️","🌈","🔥","💐","🌹","🎂","🍰","🧋","🍫",
  "🐶","🐱","🐷","🐰","🐻","🦊","🐼","🐸","🐧","🦋","🌷","🍀",
];

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/** 她的评论框：文字 + emoji 表情 + 图片（最多三张）。
 *  initial 不传时进页面再拉一次评论（翻手账翻到哪页拉哪页）；
 *  她自己能翻看自己留过的评论，全文只有他能在 /write 后台看到 */
export function CommentBox({
  entryId,
  initial,
  heading = "回他几句话",
  placeholder = "读完这页，想说点什么呢",
  compact = false,
}: {
  entryId: string;
  initial?: ReplyItem[];
  heading?: string;
  placeholder?: string;
  /** 手账卡片里收窄一点 */
  compact?: boolean;
}) {
  const [replies, setReplies] = useState<ReplyItem[]>(initial ?? []);
  const [text, setText] = useState("");
  const [images, setImages] = useState<MarkMedia[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 没给 initial（手账页懒加载）：挂载后拉这一页的评论
  useEffect(() => {
    if (initial) return;
    let alive = true;
    fetch(`/api/marks?entryId=${entryId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { replies?: ReplyItem[] } | null) => {
        if (alive && d?.replies) setReplies(d.replies);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [entryId, initial]);

  function insertEmoji(em: string) {
    const el = taRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    const next = (text.slice(0, start) + em + text.slice(end)).slice(0, MAX_BODY);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      if (el) el.selectionStart = el.selectionEnd = Math.min(start + em.length, next.length);
    });
  }

  async function pickImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    for (const file of Array.from(files).slice(0, MAX_IMAGES - images.length)) {
      if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
        setError("只能传图片哦");
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/marks/upload", { method: "POST", body: fd });
        const data = (await res.json().catch(() => ({}))) as Partial<MarkMedia> & { error?: string };
        if (res.ok && data.id) {
          setImages((imgs) => [...imgs, { id: data.id!, url: data.url ?? `/api/media/${data.id}`, thumbUrl: data.thumbUrl ?? null, width: null, height: null }]);
        } else {
          setError(data.error ?? "这张图没传上，再试一次？");
        }
      } catch {
        setError("网络好像打了个盹，图没传上");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function send() {
    if (busy || uploading > 0) return;
    if (!text.trim() && images.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, kind: "reply", body: text, mediaIds: images.map((i) => i.id) }),
      });
      const data = (await res.json().catch(() => ({}))) as { reply?: ReplyItem; error?: string };
      if (res.ok && data.reply) {
        setReplies((r) => [...r, data.reply!]);
        setText("");
        setImages([]);
        setEmojiOpen(false);
      } else {
        setError(data.error ?? "没寄出去，再试一次？");
      }
    } catch {
      setError("网络好像打了个盹，再试一次？");
    } finally {
      setBusy(false);
    }
  }

  const canSend = !busy && uploading === 0 && (text.trim().length > 0 || images.length > 0);

  return (
    <section aria-label={heading} className={cn("border-t border-dashed border-ink/20 pt-5", compact ? "mt-6" : "mt-10")}>
      {replies.length > 0 && (
        <ul className="mb-5 space-y-3">
          {replies.map((r, i) => (
            <li key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-rose-soft px-4 py-2.5">
              {r.body && <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed">{r.body}</p>}
              {r.media.length > 0 && (
                <div className={cn("mt-1.5 flex flex-wrap gap-1.5", r.body && "mt-2")}>
                  {r.media.map((m) => (
                    <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg transition hover:opacity-85" aria-label="放大看她发的图">
                      {/* eslint-disable-next-line @next/next/no-img-element -- 评论图走带鉴权的 /api/media，next/image 不适用 */}
                      <img src={m.thumbUrl ?? m.url} alt="" loading="lazy" className="max-h-28 max-w-[10rem] rounded-lg object-cover" />
                    </a>
                  ))}
                </div>
              )}
              <p className="mt-1 text-right font-round text-[10px] tracking-widest text-rose-deep/60">{fmt(r.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="font-script text-2xl text-rose-deep">{heading}</p>

      {/* 已选的图：上传中转圈、传好可撤回 */}
      {images.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((m) => (
            <span key={m.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- 同上 */}
              <img src={m.thumbUrl ?? m.url} alt="" className="size-16 rounded-xl border border-ink/10 object-cover" />
              <button
                type="button"
                onClick={() => setImages((imgs) => imgs.filter((x) => x.id !== m.id))}
                aria-label="不要这张了"
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-ink/80 text-paper transition hover:bg-rose-deep"
              >
                <X weight="bold" className="size-3" />
              </button>
            </span>
          ))}
          {uploading > 0 && (
            <span className="grid size-16 place-items-center rounded-xl border-2 border-dashed border-ink/20 font-round text-[11px] text-ink-soft">
              传图中…
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex items-end gap-2">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_BODY))}
          rows={2}
          placeholder={placeholder}
          aria-label="评论内容"
          className="min-h-11 flex-1 resize-none rounded-2xl border-2 border-ink/15 bg-paper px-4 py-2.5 text-[0.95rem] outline-none focus:border-rose"
        />
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label="插个表情"
            title="插个表情"
            className={cn(
              "grid size-9 place-items-center rounded-full border transition",
              emojiOpen ? "border-rose bg-rose-soft text-rose-deep" : "border-ink/15 text-ink-soft hover:bg-ink/5 hover:text-ink"
            )}
          >
            <Smiley weight="fill" className="size-4.5" />
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={images.length >= MAX_IMAGES || uploading > 0}
            aria-label="发张图"
            title={`发张图（最多 ${MAX_IMAGES} 张）`}
            className="grid size-9 place-items-center rounded-full border border-ink/15 text-ink-soft transition hover:bg-ink/5 hover:text-ink disabled:opacity-40"
          >
            <ImageIcon weight="fill" className="size-4.5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void pickImages(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <button type="button" onClick={send} disabled={!canSend} className="btn-primary shrink-0 px-4 py-2.5 text-sm">
          <PaperPlaneTilt weight="fill" className="size-4" />
          {busy ? "寄出中…" : "寄回去"}
        </button>
      </div>

      <AnimatePresence>
        {emojiOpen && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="card-paper mt-3 max-w-md p-3"
          >
            <div className="grid grid-cols-12 gap-0.5">
              {EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => insertEmoji(em)}
                  className="grid size-7 place-items-center rounded-lg text-lg transition hover:scale-125 hover:bg-rose-soft/60"
                >
                  {em}
                </button>
              ))}
            </div>
            <p className="mt-2 text-center font-round text-[11px] tracking-wider text-ink-soft/60">点一下就写进去啦</p>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p className="mt-2 text-sm font-bold text-rose-deep">{error}</p>}
      <p className="mt-2 font-round text-[11px] tracking-wider text-ink-soft/60">
        {text.length > 0 && <span className="mr-2">{text.length}/{MAX_BODY}</span>}
        可以写字、点笑脸插表情、传张图；只有他能在后台看到
      </p>
    </section>
  );
}
