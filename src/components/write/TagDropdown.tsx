"use client";

import { tagColor } from "@/lib/tags";

/** 标签输入框聚焦时弹出的点选下拉：点一下直接贴上，不用再回车。
 *  列表 = 标签库里还没贴上的、跟已输入文字能对上的 */
export function TagDropdown({
  all,
  exclude,
  typed,
  onPick,
}: {
  all: string[];
  exclude: string[];
  typed: string;
  onPick: (tag: string) => void;
}) {
  const kw = typed.trim().toLowerCase();
  const hits = all.filter((t) => !exclude.includes(t) && (!kw || t.toLowerCase().includes(kw))).slice(0, 8);
  if (hits.length === 0) return null;
  return (
    <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-48 overflow-y-auto rounded-xl border border-ink/15 bg-paper p-1 shadow-lifted">
      {hits.map((t) => (
        <button
          key={t}
          type="button"
          // mousedown 先于 blur：preventDefault 让输入框不失焦，点击稳稳吃到
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(t);
          }}
          className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-sm text-ink transition hover:bg-rose-soft/50"
        >
          <span className="size-2 shrink-0 rounded-full" style={{ background: tagColor(t) }} aria-hidden />
          <span className="truncate">{t}</span>
        </button>
      ))}
    </div>
  );
}
