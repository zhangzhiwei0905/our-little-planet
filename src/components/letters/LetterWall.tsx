"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Envelope } from "./Envelope";
import { LetterView, type LetterData } from "./LetterView";

const READ_KEY = "journal-read-letters";
const EMPTY = new Set<string>();

// getSnapshot 必须返回稳定引用：按 localStorage 原始串缓存 Set
let cache: { raw: string; set: Set<string> } | null = null;
function getReadSnapshot(): Set<string> {
  const raw = localStorage.getItem(READ_KEY) ?? "[]";
  if (!cache || cache.raw !== raw) {
    try {
      cache = { raw, set: new Set(JSON.parse(raw) as string[]) };
    } catch {
      cache = { raw, set: EMPTY };
    }
  }
  return cache.set;
}
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** 信封墙：按时间正序编号，未读封着火漆；读没读过记在这台设备上 */
export function LetterWall({
  letters,
  author,
}: {
  letters: (LetterData & { index: number })[];
  author: boolean;
}) {
  // SSR 时按空集渲染（全部未读），挂载后自动切到本机记录
  const readIds = useSyncExternalStore(subscribe, getReadSnapshot, () => EMPTY);
  const [openId, setOpenId] = useState<string | null>(null);

  const markRead = useCallback((id: string) => {
    try {
      const next = new Set(getReadSnapshot());
      next.add(id);
      localStorage.setItem(READ_KEY, JSON.stringify([...next]));
    } catch {
      /* 私密模式存不了也不影响读信 */
    }
    // 同一个标签页不会触发 storage 事件，手动广播一次
    window.dispatchEvent(new Event("storage"));
  }, []);

  // 读者视角的列表已过滤掉未到期的定时信；这里按日期正序
  const ordered = [...letters].sort((a, b) => (a.entryDate < b.entryDate ? -1 : 1));
  const open = ordered.find((l) => l.id === openId) ?? null;
  const unreadCount = ordered.filter((l) => !readIds.has(l.id)).length;

  return (
    <div>
      {ordered.length > 1 && (
        <p className="mb-10 text-center font-round text-sm tracking-widest text-ink-soft">
          共 {ordered.length} 封 · {unreadCount > 0 ? `${unreadCount} 封还没拆开` : "每一封都拆过了"}
        </p>
      )}
      <div
        className={
          ordered.length === 1
            ? "mx-auto grid w-full max-w-[300px] grid-cols-1 justify-items-center pt-4"
            : "mx-auto grid max-w-3xl grid-cols-1 justify-items-center gap-10 pt-4 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {ordered.map((letter, i) => (
          <Envelope
            key={letter.id}
            date={letter.entryDate}
            index={i}
            read={readIds.has(letter.id)}
            onOpen={() => {
              setOpenId(letter.id);
              markRead(letter.id);
            }}
          />
        ))}
      </div>

      <LetterView letter={open} author={author} onClose={() => setOpenId(null)} />
    </div>
  );
}
