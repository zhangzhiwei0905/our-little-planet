"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarBlank, Check, CheckSquare, Tag, Trash, PencilSimple, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { NOTE_TONES, pickOf, tiltOf } from "@/lib/tilt";
import { sanitizeTags, tagColor, MAX_TAGS_PER_ENTRY } from "@/lib/tags";
import { PolaroidCard } from "@/components/journal/PolaroidCard";
import { StickyNote } from "@/components/journal/StickyNote";
import { TagDropdown } from "@/components/write/TagDropdown";
import { Lightbox, type LightboxPhoto } from "./Lightbox";
import { useToast } from "@/components/Toast";

type AlbumItem = LightboxPhoto;

/** 管理模式里每张拍立得下面的快速编辑：描述（失焦/回车保存）+ 日期（选了就存）。
 *  一次 PATCH 只带改过的字段，和灯箱里的铅笔同一套接口 */
function WallQuickEdit({
  mediaId,
  caption,
  date,
  onSaved,
}: {
  mediaId: string;
  caption: string | null;
  date: string;
  onSaved: (patch: { caption?: string | null; entryDate?: string }) => void;
}) {
  const toast = useToast();
  const [cap, setCap] = useState(caption ?? "");
  const [saving, setSaving] = useState(false);
  // 外部描述变了（比如灯箱里改完）同步进草稿：渲染期校正，比 effect 里 setState 稳
  const [lastCaption, setLastCaption] = useState(caption);
  if (caption !== lastCaption) {
    setLastCaption(caption);
    setCap(caption ?? "");
  }

  async function save(patch: { caption?: string; entryDate?: string }) {
    setSaving(true);
    try {
      const res = await fetch(`/api/media/${mediaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "保存失败");
      }
      onSaved(patch);
    } catch (e) {
      toast(e instanceof Error ? e.message : "没保存上，再试一次", "error");
    } finally {
      setSaving(false);
    }
  }

  const capDirty = cap.trim() !== (caption ?? "");

  return (
    <div className="flex flex-col gap-1.5">
      <input
        value={cap}
        maxLength={300}
        disabled={saving}
        placeholder="写句描述…"
        onChange={(e) => setCap(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (capDirty) void save({ caption: cap.trim() });
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setCap(caption ?? "");
          }
        }}
        onBlur={() => {
          if (capDirty) void save({ caption: cap.trim() });
        }}
        className="w-full rounded-lg border border-ink/15 bg-paper px-2 py-1 text-sm outline-none placeholder:text-ink-soft/50 focus:border-rose"
      />
      <div className="flex items-center justify-between gap-1.5">
        <input
          type="date"
          value={date}
          disabled={saving}
          onChange={(e) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value !== date) {
              void save({ entryDate: e.target.value });
            }
          }}
          className="rounded-lg border border-ink/15 bg-paper px-2 py-1 font-round text-xs font-bold text-ink outline-none focus:border-rose"
        />
        {saving && <span className="font-round text-[10px] font-bold text-ink-soft/70">保存中…</span>}
      </div>
    </div>
  );
}

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return `${y} 年 ${Number(mo)} 月`;
}

/** 月份索引贴上的数量徽章：单独一颗小圆标，不跟在文字后面（不然「9 月 36」看着像日期） */
function CountBadge({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={cn(
        "grid min-w-5 place-items-center rounded-full px-1 font-round text-[11px] font-bold leading-4",
        active ? "bg-paper/25 text-paper" : "bg-ink/10 text-ink-soft"
      )}
    >
      {n}
    </span>
  );
}

/** 拍立得墙：月份 + 标签双筛选、瀑布墙、灯箱。
 *  作者在灯箱里改过的描述，回填到这份本地状态，墙上的拍立得跟着换字 */
export function AlbumGrid({
  photos,
  author = false,
  knownTags = [],
}: {
  photos: AlbumItem[];
  author?: boolean;
  /** 全局标签库：批量贴标签时的点选候选 */
  knownTags?: string[];
}) {
  const toast = useToast();
  const [all, setAll] = useState(photos);
  const [month, setMonth] = useState<string>("all");
  const [tag, setTag] = useState<string>("all");
  const [day, setDay] = useState("");
  const [kind, setKind] = useState<"all" | "photo" | "video">("all");
  const [index, setIndex] = useState<number | null>(null);
  // 管理模式（作者专用）：点「管理」后墙上每张卡能勾选批量删/批量贴标签，点铅笔浮出描述/日期编辑
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);
  // 批量贴标签面板：攒一批要贴的标签，一次贴到所有选中的照片上
  const [tagPanel, setTagPanel] = useState(false);
  const [tagsToAdd, setTagsToAdd] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");

  const onCaption = useCallback((id: string, caption: string | null) => {
    setAll((prev) => prev.map((p) => (p.id === id ? { ...p, caption } : p)));
  }, []);

  // 删除：从墙上拿掉这一张（服务器和 OSS 已由接口清理）。灯箱索引不动，数组前移正好落到下一张
  const onDelete = useCallback((id: string) => {
    setAll((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBatchConfirm(false);
  }, []);

  /** 批量删除：逐张走 DELETE（连 OSS 一起清），进度亮在底部条上 */
  async function batchDelete() {
    if (!batchConfirm) {
      setBatchConfirm(true);
      return;
    }
    const ids = [...selected];
    setBatchConfirm(false);
    let ok = 0;
    for (const id of ids) {
      setBatchProgress(`正在删除 ${ok + 1}/${ids.length}…`);
      const res = await fetch(`/api/media/${id}?force=1`, { method: "DELETE" }).catch(() => null);
      if (res && res.ok) ok++;
    }
    setBatchProgress(null);
    setAll((prev) => prev.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
    toast(ok === ids.length ? `已删除 ${ok} 张（OSS 里的文件也一起清了）` : `删了 ${ok}/${ids.length} 张，没删成功的可以再选一次`);
  }

  // 确认态 3 秒没人点就自动收回
  useEffect(() => {
    if (!batchConfirm) return;
    const t = setTimeout(() => setBatchConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [batchConfirm]);

  function addTag(name: string) {
    const clean = sanitizeTags([name]);
    if (clean.length === 0) return;
    setTagsToAdd((prev) => (prev.includes(clean[0]) ? prev : sanitizeTags([...prev, clean[0]])));
    setTagDraft("");
  }

  /** 批量贴标签：每张的现有标签 + 这批新标签合并后 PATCH 上去，进度亮在底部条上 */
  async function batchTag() {
    const adding = tagsToAdd;
    if (adding.length === 0) return;
    const ids = [...selected];
    setTagPanel(false);
    let ok = 0;
    for (const id of ids) {
      setBatchProgress(`正在贴标签 ${ok + 1}/${ids.length}…`);
      const current = all.find((p) => p.id === id);
      const merged = sanitizeTags([...(current?.tags ?? []), ...adding]);
      const res = await fetch(`/api/media/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: merged }),
      }).catch(() => null);
      if (res && res.ok) {
        ok++;
        setAll((prev) => prev.map((p) => (p.id === id ? { ...p, tags: merged } : p)));
      }
    }
    setBatchProgress(null);
    setTagsToAdd([]);
    toast(
      ok === ids.length
        ? `已给 ${ok} 张贴上「${adding.join("、")}」`
        : `贴上了 ${ok}/${ids.length} 张，没贴成功的可以再选一次`
    );
  }

  // 改日期：照片挪去那天的页面。月份筛选开着的话先切回「全部」，
  // 不然这张从当前月份消失，灯箱翻页会踩空
  const onDate = useCallback(
    (id: string, date: string) => {
      setMonth((m) => (m === "all" ? m : "all"));
      setAll((prev) => prev.map((p) => (p.id === id ? { ...p, entryDate: date } : p)));
    },
    []
  );

  // 级联筛选：每一行的计数都反映「其他行已经选了什么」——
  // 选了月份，下面照片/视频的总数跟着变；选了视频，月份和标签的计数也只剩视频的量
  const inTimeAndTag = (p: AlbumItem) =>
    (month === "all" || p.entryDate.startsWith(month)) &&
    (day === "" || p.entryDate === day) &&
    (tag === "all" || (p.tags ?? []).includes(tag));
  const inTimeAndKind = (p: AlbumItem) =>
    (month === "all" || p.entryDate.startsWith(month)) &&
    (day === "" || p.entryDate === day) &&
    (kind === "all" || (kind === "photo" ? p.kind !== "video" : p.kind === "video"));

  const months = useMemo(() => {
    const set = new Map<string, number>();
    for (const p of all) {
      if (!inTimeAndKind(p) || (tag !== "all" && !(p.tags ?? []).includes(tag))) continue;
      const m = p.entryDate.slice(0, 7);
      set.set(m, (set.get(m) ?? 0) + 1);
    }
    return [...set.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, day, kind, tag]);

  // 标签统计（当前时间+类型范围内有多少张贴着它），按数量从多到少排；选中的标签哪怕量为 0 也留在列表里
  const tags = useMemo(() => {
    const set = new Map<string, number>();
    for (const p of all) {
      if (!inTimeAndKind(p)) continue;
      for (const t of p.tags ?? []) set.set(t, (set.get(t) ?? 0) + 1);
    }
    if (tag !== "all" && !set.has(tag)) set.set(tag, 0);
    return [...set.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, month, day, kind, tag]);

  const shown = useMemo(
    () =>
      all.filter(
        (p) =>
          (month === "all" || p.entryDate.startsWith(month)) &&
          (tag === "all" || (p.tags ?? []).includes(tag)) &&
          (day === "" || p.entryDate === day) &&
          (kind === "all" || (kind === "photo" ? p.kind !== "video" : p.kind === "video"))
      ),
    [all, month, tag, day, kind]
  );
  const photoN = useMemo(
    () => all.filter((p) => inTimeAndTag(p) && p.kind !== "video").length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, month, day, tag]
  );
  const videoN = useMemo(
    () => all.filter((p) => inTimeAndTag(p) && p.kind === "video").length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, month, day, tag]
  );
  const kindAllN = photoN + videoN;
  const monthAllN = useMemo(
    () => all.filter((p) => inTimeAndKind(p) && (tag === "all" || (p.tags ?? []).includes(tag))).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, day, kind, tag]
  );

  // 每组照片的第一张（贴「这组照片的一句话」便利贴用）
  const noteAt = useMemo(() => {
    const seen = new Set<string>();
    const first = new Set<number>();
    shown.forEach((p, i) => {
      if (p.eid && p.note && !seen.has(p.eid)) {
        seen.add(p.eid);
        first.add(i);
      }
    });
    return first;
  }, [shown]);

  return (
    <div>
      {/* 月份索引贴 + 按具体某天看 */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => {
            setMonth("all");
            setDay("");
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold transition-all duration-300 ease-spring",
            month === "all" ? "-translate-y-px bg-rose-deep text-paper shadow-md" : "border border-ink/20 text-ink-soft hover:bg-ink/5"
          )}
        >
          全部
          <CountBadge n={monthAllN} active={month === "all"} />
        </button>
        {months.map(([m, n]) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMonth(m);
              setDay(""); // 换了月份，具体到天的筛选一起清掉
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold transition-all duration-300 ease-spring",
              month === m
                ? "-translate-y-px bg-rose-deep text-paper shadow-md"
                : "border border-ink/20 text-ink-soft hover:bg-ink/5"
            )}
          >
            {monthLabel(m)}
            <CountBadge n={n} active={month === m} />
          </button>
        ))}
        {/* 按某一天看：选了日期自动切到那个月；旁边有 × 一键清掉 */}
        <span className={cn("flex items-center gap-1 rounded-full border px-3 py-1.5 transition", day ? "border-rose-deep/60 bg-rose-soft/50" : "border-ink/20")}>
          <CalendarBlank weight="bold" className="size-3.5 text-ink-soft" />
          <input
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              if (e.target.value) setMonth(e.target.value.slice(0, 7));
            }}
            aria-label="按具体日期筛选"
            className="bg-transparent font-round text-sm font-bold text-ink outline-none"
          />
          {day && (
            <button type="button" onClick={() => setDay("")} aria-label="清除日期筛选" className="grid size-5 place-items-center rounded-full text-ink-soft transition hover:bg-ink/10 hover:text-ink">
              <X weight="bold" className="size-3" />
            </button>
          )}
        </span>
        {/* 作者的管理开关：开了以后勾选批量删、卡片下面直接改描述和日期 */}
        {author && !batchProgress && (
          <button
            type="button"
            onClick={() => {
              setManage((v) => !v);
              setSelected(new Set());
              setEditingId(null);
              setBatchConfirm(false);
              setTagPanel(false);
              setTagsToAdd([]);
              setTagDraft("");
            }}
            aria-pressed={manage}
            className={cn(
              "ml-auto flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold transition-all duration-300 ease-spring",
              manage ? "-translate-y-px bg-ink text-paper shadow-md" : "border border-ink/20 text-ink-soft hover:bg-ink/5"
            )}
          >
            <PencilSimple weight="bold" className="size-3.5" />
            {manage ? "完成" : "管理"}
          </button>
        )}
      </div>

      {/* 类型筛选（照片含 Live 图）+ 标签索引贴：小圆点 = 这个标签的专属颜色 */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(
          [
            ["all", `全部 ${kindAllN}`],
            ["photo", `照片 ${photoN}`],
            ["video", `视频 ${videoN}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            aria-pressed={kind === value}
            className={cn(
              "rounded-full px-3.5 py-1 text-sm font-bold transition-all duration-300 ease-spring",
              kind === value ? "-translate-y-px bg-mist text-ink shadow-md" : "border border-ink/20 text-ink-soft hover:bg-ink/5"
            )}
          >
            {label}
          </button>
        ))}
        {tags.length > 0 && <span aria-hidden className="mx-1 h-4 w-px bg-ink/15" />}
        {tags.map(([t, n]) => {
            const active = tag === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTag(active ? "all" : t)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3.5 py-1 text-sm font-bold transition-all duration-300 ease-spring",
                  active
                    ? "-translate-y-px bg-ink text-paper shadow-md"
                    : "border border-dashed border-ink/25 text-ink-soft hover:border-ink/50 hover:bg-ink/5"
                )}
              >
                <span className="size-2 rounded-full" style={{ background: tagColor(t) }} aria-hidden />
                {t}
                <span className={cn("font-round text-[11px] font-bold leading-4", active ? "text-paper/70" : "text-ink-soft/60")}>{n}</span>
              </button>
            );
          })}
      </div>

      {shown.length === 0 && (
        <p className="card-paper mx-auto max-w-md py-10 text-center text-ink-soft">
          这组筛选下还没有照片——换个月份、日期或标签试试？
        </p>
      )}

      {/* 瀑布墙：每组「存照片」的第一张前面，贴一张写着那句话的便利贴。
          管理模式下卡片变成可勾选，下面挂着描述/日期快速编辑 */}
      <div className="columns-2 gap-6 sm:columns-3 lg:columns-4 [&>*]:mb-6">
        {shown.map((p, i) => {
          const firstOfGroup = noteAt.has(i);
          const sel = selected.has(p.id);
          return (
            <Fragment key={p.id}>
              {firstOfGroup && (
                <div className="break-inside-avoid">
                  <StickyNote text={p.note!} tone={pickOf(p.eid!, NOTE_TONES)} tilt={tiltOf(p.eid!, 2)} />
                </div>
              )}
              <div className="relative break-inside-avoid">
                <button
                  type="button"
                  className={cn("relative block w-full", manage ? "cursor-pointer" : "cursor-zoom-in")}
                  onClick={() => (manage ? toggleSelect(p.id) : setIndex(i))}
                  aria-label={manage ? (sel ? `取消选择 ${p.caption ?? "这张"}` : `选择 ${p.caption ?? "这张"}`) : p.caption ?? "放大看这张照片"}
                  aria-pressed={manage ? sel : undefined}
                >
                  {manage && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute right-2 top-2 z-10 grid size-6 place-items-center rounded-full border-2 shadow transition",
                        sel ? "border-rose-deep bg-rose-deep text-paper" : "border-paper/90 bg-paper/70 text-transparent backdrop-blur"
                      )}
                    >
                      <Check weight="bold" className="size-3.5" />
                    </span>
                  )}
                  <div className={cn("transition-shadow", manage && sel && "rounded-xl ring-4 ring-rose-deep/70")}>
                    <PolaroidCard
                      src={p.kind === "video" ? null : (p.thumbUrl ?? p.url)}
                      video={p.kind === "video" ? p.url : null}
                      poster={p.kind === "video" ? (p.posterUrl ?? null) : null}
                      hevc={p.hevc}
                      caption={p.caption}
                      alt={p.caption ?? "我们的照片"}
                      tags={p.tags}
                      tilt={tiltOf(p.id)}
                      tone={pickOf(p.id, ["rose", "butter", "mist", "peach", "matcha"])}
                      tape="none"
                      width={p.width}
                      height={p.height}
                      liveVideo={p.liveVideo}
                      noHover={manage}
                      className="w-full"
                    />
                  </div>
                </button>
                {/* 管理模式：改描述/日期的浮层。悬浮在卡片上不占布局空间，
                    不然每张卡变高一截，瀑布流重新分列、照片看着就"换位置"了 */}
                {manage && (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditingId((prev) => (prev === p.id ? null : p.id))}
                      aria-label={editingId === p.id ? "收起编辑" : "改这张的描述和日期"}
                      aria-expanded={editingId === p.id}
                      className="absolute bottom-2 right-2 z-10 grid size-7 place-items-center rounded-full bg-paper/85 text-ink shadow transition hover:bg-paper"
                    >
                      <PencilSimple weight="bold" className={cn("size-3.5", editingId === p.id && "text-rose-deep")} />
                    </button>
                    {editingId === p.id && (
                      <div className="absolute inset-x-0 top-full z-20 mt-1.5 rounded-xl bg-card p-3 shadow-lifted">
                        <WallQuickEdit
                          mediaId={p.id}
                          caption={p.caption}
                          date={p.entryDate}
                          onSaved={(patch) => {
                            if (patch.entryDate && patch.entryDate !== p.entryDate) {
                              // 改日期 = 挪去那天的页面；月份筛选开着会看不见它，先切回全部
                              setMonth((m) => (m === "all" ? m : "all"));
                            }
                            setAll((prev) =>
                              prev.map((x) =>
                                x.id === p.id
                                  ? {
                                      ...x,
                                      caption: patch.caption !== undefined ? patch.caption : x.caption,
                                      entryDate: patch.entryDate ?? x.entryDate,
                                    }
                                  : x
                              )
                            );
                          }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* 管理模式的底部操作条：全选 / 批量删除（两段确认） */}
      {manage && !batchProgress && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-full bg-ink px-5 py-2.5 text-paper shadow-lifted">
          <span className="font-round text-xs font-bold tracking-wider text-paper/80">
            {selected.size > 0 ? `已选 ${selected.size} 张` : "点照片勾选"}
          </span>
          <button
            type="button"
            onClick={() => {
              setSelected((prev) => (prev.size === shown.length ? new Set() : new Set(shown.map((p) => p.id))));
              setBatchConfirm(false);
            }}
            className="flex items-center gap-1.5 rounded-full bg-paper/15 px-3.5 py-1.5 text-xs font-bold transition hover:bg-paper/30"
          >
            <CheckSquare weight="bold" className="size-3.5" />
            {selected.size === shown.length && shown.length > 0 ? "取消全选" : "全选本组"}
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => {
                setBatchConfirm(false);
                setTagPanel((v) => !v);
              }}
              aria-expanded={tagPanel}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition",
                tagPanel ? "bg-butter text-ink" : "bg-paper/15 text-paper hover:bg-paper/30"
              )}
            >
              <Tag weight="bold" className="size-3.5" />
              贴标签
            </button>
          )}
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => {
                setTagPanel(false);
                void batchDelete();
              }}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition",
                batchConfirm ? "bg-rose-deep text-paper" : "bg-paper/15 text-paper hover:bg-paper/30"
              )}
            >
              <Trash weight="bold" className="size-3.5" />
              {batchConfirm ? `确认删除 ${selected.size} 张？` : `删除所选`}
            </button>
          )}
        </div>
      )}
      {/* 批量贴标签面板：浮在操作条上方，攒好标签一次贴到所有选中的照片 */}
      {manage && tagPanel && !batchProgress && selected.size > 0 && (
        <div className="fixed bottom-20 left-1/2 z-40 w-[min(92vw,26rem)] -translate-x-1/2 rounded-2xl bg-card p-4 shadow-lifted">
          <p className="mb-2 text-sm font-bold text-ink">
            给选中的 {selected.size} 张贴标签
          </p>
          <div className="relative">
            <input
              value={tagDraft}
              maxLength={20}
              placeholder="输入标签名，回车贴上…"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addTag(tagDraft);
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setTagPanel(false);
                }
              }}
              className="w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm outline-none placeholder:text-ink-soft/50 focus:border-rose"
            />
            <TagDropdown
              all={[...new Set([...knownTags, ...all.flatMap((p) => p.tags ?? [])])]}
              exclude={tagsToAdd}
              typed={tagDraft}
              onPick={addTag}
            />
          </div>
          {tagsToAdd.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {tagsToAdd.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 rounded-full border border-ink/15 bg-paper px-2.5 py-1 text-xs font-bold text-ink"
                >
                  <span className="size-2 rounded-full" style={{ background: tagColor(t) }} aria-hidden />
                  {t}
                  <button
                    type="button"
                    onClick={() => setTagsToAdd((prev) => prev.filter((x) => x !== t))}
                    aria-label={`去掉标签 ${t}`}
                    className="grid size-4 place-items-center rounded-full text-ink-soft transition hover:bg-ink/10 hover:text-ink"
                  >
                    <X weight="bold" className="size-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="mt-2.5 text-xs text-ink-soft">
            新标签会和照片已有的合并（每张最多 {MAX_TAGS_PER_ENTRY} 个）
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setTagPanel(false)} className="btn-ghost px-3 py-1.5 text-xs">
              取消
            </button>
            <button
              type="button"
              disabled={tagsToAdd.length === 0}
              onClick={() => void batchTag()}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition",
                tagsToAdd.length === 0
                  ? "cursor-not-allowed bg-ink/10 text-ink-soft/50"
                  : "bg-rose-deep text-paper shadow hover:-translate-y-px"
              )}
            >
              <Tag weight="bold" className="size-3.5" />
              贴到 {selected.size} 张上
            </button>
          </div>
        </div>
      )}
      {batchProgress && (
        <div className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink px-5 py-2.5 font-round text-xs font-bold tracking-wider text-paper shadow-lifted">
          {batchProgress}
        </div>
      )}

      <Lightbox
        photos={shown}
        index={index}
        onClose={() => setIndex(null)}
        onNav={setIndex}
        canEdit={author}
        canEditDate={author}
        canDelete={author}
        onCaptionChange={onCaption}
        onDateChange={onDate}
        onDelete={onDelete}
      />
    </div>
  );
}
