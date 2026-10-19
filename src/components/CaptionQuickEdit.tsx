"use client";

import { useEffect, useRef, useState } from "react";
import { Check, PencilSimple, Trash, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/Toast";

/** 灯箱里的「快速改日期」：和改描述一套交互，改的是这张照片自己的拍摄日期。
 *  保存走 PATCH /api/media/:id 的 entryDate：服务端会把它（连同 Live 配对视频）
 *  挪到那天对应的照片页，旧页搬空了自动回收。 */
export function MediaDateEdit({
  mediaId,
  date,
  onSaved,
  className,
}: {
  mediaId: string;
  date: string;
  onSaved?: (date: string) => void;
  className?: string;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(date);
  const [saving, setSaving] = useState(false);
  const cancelledRef = useRef(false);

  function begin() {
    cancelledRef.current = false;
    setDraft(date);
    setEditing(true);
  }

  async function save() {
    if (draft === date || !/^\d{4}-\d{2}-\d{2}$/.test(draft)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/media/${mediaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryDate: draft }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "保存失败");
      }
      setEditing(false);
      onSaved?.(draft);
      toast("日期改好了，这张已挪到那天的页面");
    } catch (e) {
      toast(e instanceof Error ? e.message : "没保存上，再试一次", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span className={cn("inline-flex items-center gap-2", className)}>
        <span className="font-round text-sm tracking-widest opacity-70">{date.replaceAll("-", ".")}</span>
        <button
          type="button"
          onClick={begin}
          title="改这张的日期（会挪到那天的页面）"
          aria-label="编辑这张照片的日期"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-paper/15 text-paper backdrop-blur transition hover:bg-paper/30"
        >
          <PencilSimple weight="bold" className="size-3.5" />
        </button>
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <input
        type="date"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancelledRef.current = true;
            setEditing(false);
          }
        }}
        // 深色灯箱底：让浏览器原生日期控件也走深色，否则弹出的日历是白的很突兀
        className="rounded-lg border border-paper/30 bg-transparent px-2 py-1 font-round text-sm text-paper caret-rose outline-none [color-scheme:dark] focus:border-paper/70"
      />
      <button
        type="button"
        aria-label="保存日期"
        disabled={saving}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void save()}
        className="grid size-8 place-items-center rounded-full bg-paper/15 text-paper backdrop-blur transition hover:bg-paper/30 disabled:opacity-50"
      >
        <Check weight="bold" className="size-4" />
      </button>
      <button
        type="button"
        aria-label="不改了"
        disabled={saving}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          cancelledRef.current = true;
          setEditing(false);
        }}
        className="grid size-8 place-items-center rounded-full bg-paper/15 text-paper backdrop-blur transition hover:bg-paper/30 disabled:opacity-50"
      >
        <X weight="bold" className="size-4" />
      </button>
    </span>
  );
}

/** 灯箱里的「删除这张」：作者专用。两段式确认（点一下变红「确认删除？」，再点才真删），
 *  3 秒不点自动恢复防手滑。删除走 DELETE /api/media/:id：数据库、OSS 对象、缩略图、
 *  Live 配对视频一起清——每次上传都是独立对象，不会碰到别的照片的文件。 */
export function MediaDeleteButton({
  mediaId,
  onDeleted,
  className,
}: {
  mediaId: string;
  onDeleted?: () => void;
  className?: string;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  async function del() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/media/${mediaId}?force=1`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "删除失败");
      }
      onDeleted?.();
      toast("删掉了，服务器和 OSS 上的文件也一起清了");
    } catch (e) {
      toast(e instanceof Error ? e.message : "没删掉，再试一次", "error");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void del()}
      disabled={busy}
      onMouseDown={(e) => e.preventDefault()}
      title="从相册删掉这一张（连 OSS 里的文件一起清，别的不受影响）"
      aria-label={confirming ? "再点一次确认删除" : "删除这张照片"}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-xs font-bold tracking-[0.12em] text-paper backdrop-blur transition disabled:opacity-50",
        confirming ? "w-auto bg-rose-deep px-3.5" : "w-8 bg-paper/15 hover:bg-rose-deep/80",
        className
      )}
    >
      {confirming ? (
        "确认删除？"
      ) : (
        <Trash weight="bold" className="size-3.5" />
      )}
    </button>
  );
}

/** 灯箱里的「快速改描述」：作者在任何看图的地方点铅笔就能改这一张的一句话，
 *  保存走 PATCH /api/media/:id（服务端校验作者口令），存好回调 onSaved 让墙上的卡片同步换字。
 *  配色按深色灯箱底走的（text-paper / 半透明按钮），只放在灯箱里用 */
export function CaptionQuickEdit({
  mediaId,
  caption,
  onSaved,
  className,
}: {
  mediaId: string;
  caption: string | null;
  onSaved?: (caption: string | null) => void;
  className?: string;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function begin() {
    cancelledRef.current = false;
    setDraft(caption ?? "");
    setEditing(true);
  }

  async function save() {
    const clean = draft.trim();
    if (clean === (caption ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/media/${mediaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: clean }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "保存失败");
      }
      setEditing(false);
      onSaved?.(clean.length > 0 ? clean : null);
      toast("这句已经写上了");
    } catch (e) {
      toast(e instanceof Error ? e.message : "没保存上，再试一次", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span className={cn("inline-flex items-center gap-2.5", className)}>
        {caption && <span className="font-script text-3xl leading-none">{caption}</span>}
        <button
          type="button"
          onClick={begin}
          title="改一改这张的描述"
          aria-label="编辑这张照片的描述"
          className={cn(
            "grid shrink-0 place-items-center rounded-full text-paper backdrop-blur transition",
            caption
              ? "size-7 bg-paper/15 hover:bg-paper/30"
              : "h-8 border border-dashed border-paper/45 px-3 font-hand text-base text-paper/80 hover:border-paper/75 hover:text-paper"
          )}
        >
          {caption ? <PencilSimple weight="bold" className="size-3.5" /> : "＋ 写一句话"}
        </button>
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <input
        ref={inputRef}
        value={draft}
        maxLength={300}
        disabled={saving}
        placeholder="写下这一刻"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // 输入时别惊动灯箱的全局快捷键（Esc 关灯箱、左右键翻页）
          e.stopPropagation();
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancelledRef.current = true;
            setEditing(false);
          }
        }}
        onBlur={() => {
          // 点到别处（比如灯箱背景）：改过的先存再走；取消过或没改的就直接收起
          if (cancelledRef.current || saving) return;
          if (draft.trim() === (caption ?? "")) {
            setEditing(false);
            return;
          }
          void save();
        }}
        className="w-52 border-b border-paper/40 bg-transparent pb-1 font-script text-2xl text-paper caret-rose outline-none placeholder:text-paper/40 focus:border-paper/80 sm:w-64"
      />
      <button
        type="button"
        aria-label="保存描述"
        disabled={saving}
        // 按住按钮不让 input 先失焦（preventDefault 保住焦点），保存只走 onClick 一条路
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void save()}
        className="grid size-8 place-items-center rounded-full bg-paper/15 text-paper backdrop-blur transition hover:bg-paper/30 disabled:opacity-50"
      >
        <Check weight="bold" className="size-4" />
      </button>
      <button
        type="button"
        aria-label="不改了"
        disabled={saving}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          cancelledRef.current = true;
          setEditing(false);
        }}
        className="grid size-8 place-items-center rounded-full bg-paper/15 text-paper backdrop-blur transition hover:bg-paper/30 disabled:opacity-50"
      >
        <X weight="bold" className="size-4" />
      </button>
    </span>
  );
}
