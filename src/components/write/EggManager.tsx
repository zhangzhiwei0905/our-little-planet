"use client";

import { useState } from "react";
import { Check, SpinnerGap, X } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import { indentOnTab } from "@/lib/indent";
import { MediaPicker } from "./MediaPicker";
import type { AlbumPickItem } from "./MilestoneManager";

export type EggDTO = {
  id: string;
  title: string;
  password: string;
  revealDate: string;
  letter: string;
  photoIds: string[];
  doodles: Record<string, number>;
};

function todayStr(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** 彩蛋是否到了揭晓日子（列表徽章用） */
export function isEggArrived(e: EggDTO): boolean {
  return e.revealDate <= new Date().toLocaleDateString("en-CA");
}

/** 彩蛋表单：埋一个或改一个（在「写一页」和「本子里的一切」里用） */
export function EggForm({
  initial,
  album,
  onSaved,
  onCancel,
}: {
  initial?: EggDTO | null;
  album: AlbumPickItem[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [password, setPassword] = useState(initial?.password ?? "");
  const [revealDate, setRevealDate] = useState(initial?.revealDate ?? todayStr());
  const [letter, setLetter] = useState(initial?.letter ?? "");
  const [photoIds, setPhotoIds] = useState<string[]>(initial?.photoIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fieldCls =
    "w-full rounded-2xl border-2 border-ink/10 bg-paper px-4 py-2.5 outline-none placeholder:text-ink-soft/50 focus:border-rose";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(initial ? `/api/eggs/${initial.id}` : "/api/eggs", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, password, revealDate, letter, photoIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "保存失败了");
      toast(initial ? "彩蛋已更新" : "彩蛋埋好了");
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存失败了";
      setError(msg);
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card-paper max-w-2xl space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-bold text-ink-soft">彩蛋标题</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={fieldCls} placeholder="给她的礼物" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold text-ink-soft">揭晓日期（那天之前谁也打不开）</label>
          <input type="date" value={revealDate} onChange={(e) => setRevealDate(e.target.value)} className={fieldCls} />
          <p className="mt-1.5 text-xs leading-relaxed text-ink-soft/80">选当天零点起就到期可以打开——想测全流程就选今天，正式送她记得换成那个特别的日子。</p>
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink-soft">彩蛋密码（别用解锁本子的那个）</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={fieldCls}
          placeholder="只有她知道的那串字"
          autoComplete="off"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink-soft">
          到时候展示的信（支持空行分段、**粉色重点**、Tab 缩进）
        </label>
        <textarea
          value={letter}
          onChange={(e) => setLetter(e.target.value)}
          onKeyDown={(e) => indentOnTab(e, setLetter)}
          rows={8}
          className={`${fieldCls} letter-paper resize-y rounded-lg border-butter leading-relaxed`}
          placeholder="展信安。等到这一天，我有一件藏了很久的事想告诉你……"
        />
      </div>
      <div>
        <p className="mb-1.5 text-sm font-bold text-ink-soft">
          选进彩蛋的照片 / 视频（已选 {photoIds.length} 个，按点击顺序展示）
        </p>
        <MediaPicker
          items={album}
          selected={photoIds}
          onToggle={(id) =>
            setPhotoIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
          }
          emptyHint="本子还空着，先去记几页手账吧"
        />
      </div>

      {error && <p className="rounded-xl bg-rose-soft px-4 py-3 text-sm font-bold text-rose-deep">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? <SpinnerGap className="size-5 animate-spin" /> : <Check weight="bold" className="size-5" />}
          {initial ? "保存修改" : "埋下这个彩蛋"}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          <X className="size-4" />
          取消
        </button>
      </div>
    </form>
  );
}

/** 彩蛋管理入口在「写一页」（新建）和「本子里的一切」（编辑/删除），列表不再放这儿 */
