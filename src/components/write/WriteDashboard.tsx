"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChatTeardropText,
  Check,
  CheckCircle,
  Checks,
  Circle,
  Copy,
  EnvelopeSimple,
  Eye,
  EyeSlash,
  FilmSlate,
  FlagBanner,
  GearSix,
  Gift,
  GlobeHemisphereWest,
  HeartStraight,
  Images,
  Notebook,
  PencilSimple,
  SpinnerGap,
  Stack,
  Sticker,
  TrashSimple,
  VideoCamera,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/Toast";
import type { SiteSettings } from "@/lib/settings";
import type { BoardLayout } from "@/lib/board";
import { MAX_TAGS_PER_ENTRY, tagColor } from "@/lib/tags";
import { Sticker as StickerBadge, STICKER_NAMES, type StickerName } from "@/components/journal/Sticker";
import { EntryForm, type EntryDTO, type FormKind } from "./EntryForm";
import { BoardEditor } from "./BoardEditor";
import { SettingsForm } from "./SettingsForm";
import { TagDropdown } from "./TagDropdown";
import { Lightbox, type LightboxPhoto } from "@/components/album/Lightbox";
import { EggForm, isEggArrived, type EggDTO } from "./EggManager";
import { MilestoneForm, type AlbumPickItem, type MilestoneDTO } from "./MilestoneManager";
import { READER_NAME } from "@/lib/reader";

const TYPE_META: Record<EntryDTO["type"], { label: string; icon: typeof Notebook; cls: string }> = {
  journal: { label: "手账页", icon: Notebook, cls: "bg-matcha text-ink" },
  photo: { label: "照片", icon: Images, cls: "bg-mist text-ink" },
  quote: { label: "语录", icon: ChatTeardropText, cls: "bg-peach text-ink" },
  letter: { label: "信", icon: EnvelopeSimple, cls: "bg-rose-soft text-rose-deep" },
  board: { label: "自由页", icon: Sticker, cls: "bg-butter text-ink" },
};

/** 本子里的一切：筛选分类（手账含自由拼贴页） */
const FILTERS = [
  { value: "all", label: "全部" },
  { value: "journal", label: "手账" },
  { value: "photo", label: "相册" },
  { value: "quote", label: "语录" },
  { value: "letter", label: "信箱" },
  { value: "milestone", label: "大事记" },
  { value: "egg", label: "彩蛋" },
] as const;
type FilterValue = (typeof FILTERS)[number]["value"];

/** 统一列表的行：条目 / 大事记 / 彩蛋 摊成同一种形状（t 是判别字段，kind 是筛选用分类） */
type Row =
  | { t: "entry"; kind: FilterValue; date: string; entry: EntryDTO }
  | { t: "milestone"; kind: "milestone"; date: string; milestone: MilestoneDTO }
  | { t: "egg"; kind: "egg"; date: string; egg: EggDTO };

type Tab = "write" | "list" | "settings";
const TAB_KEYS: Tab[] = ["write", "list", "settings"];
/** /write?type=photo 从各菜单页的添加按钮直达对应新增模块 */
const TYPE_KEYS: FormKind[] = ["journal", "photo", "quote", "letter", "milestone", "egg"];

/** 列表行左侧的缩略图：有照片/视频就显示首图，没有就退回类型图标 */
function ListThumb({ entry, meta }: { entry: EntryDTO; meta: { label: string; icon: typeof Notebook; cls: string } }) {
  const Icon = meta.icon;
  const cover = entry.media.find((m) => m.kind === "photo") ?? entry.media.find((m) => m.kind === "video");
  if (!cover) {
    return (
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", meta.cls)}>
        <Icon weight="fill" className="size-5" />
      </span>
    );
  }
  if (cover.kind === "video") {
    // 有服务端抽的封面就直接用图（不用拉视频元信息，HEVC 也不会黑块），没有再退首帧
    return cover.posterUrl ? (
      /* eslint-disable-next-line @next/next/no-img-element -- 视频封面，带鉴权的接口地址 */
      <img
        src={cover.posterUrl}
        alt=""
        loading="lazy"
        className="size-11 shrink-0 rounded-xl border border-ink/10 bg-ink/5 object-cover"
      />
    ) : (
      <video
        src={`${cover.url}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        aria-hidden
        className="size-11 shrink-0 rounded-xl border border-ink/10 bg-ink/5 object-cover"
      />
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- 缩略图走带鉴权的 /api/media，next/image 不适用 */
    <img
      src={cover.url}
      alt=""
      loading="lazy"
      className="size-11 shrink-0 rounded-xl border border-ink/10 bg-ink/5 object-cover"
    />
  );
}

function isScheduled(e: EntryDTO): boolean {
  return Boolean(e.reveal_at && e.reveal_at > new Date().toLocaleDateString("en-CA"));
}

/** ISO 时间 → 「YYYY.MM.DD HH:MM」。固定按东八区算，谁的机器打开都一样
 *  （服务端渲染和客户端水合结果一致，不会闪一下跳时区） */
function fmtCST(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const t = new Date(d.getTime() + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

/** 批量模式的行首勾选圆钮 */
function PickBox({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      aria-pressed={on}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full border-2 transition",
        on ? "border-rose-deep bg-rose-deep text-paper" : "border-ink/25 text-transparent hover:border-rose-deep"
      )}
    >
      <Check weight="bold" className="size-3.5" />
    </button>
  );
}

/** 本子里的一切 · 按张管理：每一张照片/视频一行，当场改描述、挪日期、贴标签，改完自动存 */
function MediaRow({
  item,
  tagLib,
  onPatched,
  onOpen,
  onDelete,
}: {
  item: AlbumPickItem;
  tagLib: string[];
  onPatched: (id: string, patch: Partial<AlbumPickItem>) => void;
  /** 点缩略图放大看 */
  onOpen?: () => void;
  /** 删掉这张（连缩略图/Live 配对一起） */
  onDelete?: () => void;
}) {
  const toast = useToast();
  const [caption, setCaption] = useState(item.caption ?? "");
  const [date, setDate] = useState(item.entryDate ?? "");
  const [tags, setTags] = useState<string[]>(item.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [tagFocus, setTagFocus] = useState(false);
  const [saving, setSaving] = useState(false);

  async function patch(body: Record<string, unknown>, okMsg?: string) {
    setSaving(true);
    const res = await fetch(`/api/media/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setSaving(false);
    if (res && res.ok) {
      if (okMsg) toast(okMsg);
      return true;
    }
    toast("没存上，再试一次？", "error");
    return false;
  }

  async function saveCaption() {
    if (caption === (item.caption ?? "")) return;
    if (await patch({ caption }, "描述改好了")) onPatched(item.id, { caption: caption || null });
  }

  async function saveDate(next: string) {
    if (!next || next === (item.entryDate ?? "")) return;
    if (await patch({ entryDate: next }, `已挪到 ${next.replaceAll("-", ".")}`)) onPatched(item.id, { entryDate: next });
  }

  async function saveTags(next: string[]) {
    setTags(next);
    if (next.join("\u0000") === (item.tags ?? []).join("\u0000")) return;
    if (await patch({ tags: next })) onPatched(item.id, { tags: next });
  }

  return (
    <div className="card-paper flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        aria-label={item.caption ?? "放大看这张"}
        title="放大看看"
        className="relative grid size-14 shrink-0 cursor-zoom-in place-items-center overflow-hidden rounded-lg border border-ink/10 bg-ink/5 transition hover:opacity-85"
      >
        {item.kind === "video" ? (
          <>
            {item.posterUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- 视频封面，带鉴权的接口地址 */
              <img src={item.posterUrl} alt="" className="size-14 object-cover" />
            ) : (
              <VideoCamera weight="duotone" className="size-5 text-ink-soft" />
            )}
            <span className="absolute bottom-0.5 right-0.5 rounded bg-ink/60 px-1 text-[9px] font-bold text-paper">视频</span>
          </>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- 缩略图走带鉴权的 /api/media */
          <img src={item.thumbUrl ?? item.url} alt="" loading="lazy" className="size-14 object-cover" />
        )}
      </button>
      <input
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        onBlur={() => void saveCaption()}
        placeholder="写句描述…"
        className="min-w-32 flex-1 basis-48 rounded-lg border border-ink/15 bg-paper px-2.5 py-1.5 font-script text-lg leading-tight outline-none placeholder:font-hand placeholder:text-sm placeholder:text-ink-soft/50 focus:border-rose"
      />
      <input
        type="date"
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
          void saveDate(e.target.value);
        }}
        aria-label="这张的日期"
        className="rounded-full border border-ink/15 bg-paper px-2.5 py-1 font-round text-xs tracking-wider outline-none focus:border-rose"
      />
      {item.createdAt && (
        <span title={`上传于 ${fmtCST(item.createdAt)}`} className="shrink-0 font-round text-[10px] tracking-wider text-ink-soft/60">
          传于 {fmtCST(item.createdAt)}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full px-2 py-0.5 font-hand text-sm text-ink" style={{ background: tagColor(t) }}>
            {t}
            <button type="button" onClick={() => void saveTags(tags.filter((x) => x !== t))} aria-label={`撕掉标签 ${t}`} className="grid size-3.5 place-items-center rounded-full bg-ink/10 transition hover:bg-ink/25">
              <X className="size-2" weight="bold" />
            </button>
          </span>
        ))}
        {tags.length < MAX_TAGS_PER_ENTRY && (
          <div className="relative">
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onFocus={() => setTagFocus(true)}
              onBlur={() => window.setTimeout(() => setTagFocus(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "," || e.key === "，") {
                  e.preventDefault();
                  const t = tagDraft.trim().slice(0, 20).trim();
                  setTagDraft("");
                  if (t && !tags.includes(t)) void saveTags([...tags, t]);
                }
              }}
              placeholder="+标签"
              className="w-24 rounded-full border border-dashed border-ink/25 bg-transparent px-2 py-0.5 font-hand text-sm text-ink-soft outline-none placeholder:text-xs placeholder:text-ink-soft/50 focus:border-rose"
            />
            {tagFocus && (
              <TagDropdown
                all={tagLib}
                exclude={tags}
                typed={tagDraft}
                onPick={(t) => {
                  setTagDraft("");
                  void saveTags([...tags, t]);
                }}
              />
            )}
          </div>
        )}
      </div>
      {saving && <SpinnerGap className="size-3.5 shrink-0 animate-spin text-ink-soft" />}
      {onDelete && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm("确定删掉这张吗？相册和存储里都会一起删掉（Live 配对也一起）")) onDelete();
          }}
          aria-label="删掉这张"
          title="删掉这张（连 Live 配对一起）"
          className="grid size-8 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-rose-soft hover:text-rose-deep"
        >
          <TrashSimple className="size-4" />
        </button>
      )}
    </div>
  );
}

/** 相册按张管理：不按天分组，每张一行直接改 */
function MediaManager({
  items,
  tagLib,
  onDeleteTag,
  onPatched,
  onDeleteItem,
}: {
  items: AlbumPickItem[];
  tagLib: string[];
  onDeleteTag: (name: string) => void;
  onPatched: (id: string, patch: Partial<AlbumPickItem>) => void;
  onDeleteItem: (id: string) => void;
}) {
  const [zoom, setZoom] = useState<number | null>(null);
  const photos = items.filter((i) => i.kind === "photo").length;
  const videos = items.length - photos;
  return (
    <div className="space-y-2.5">
      <p className="px-1 text-sm leading-relaxed text-ink-soft">
        每一张都在这儿：改描述（失焦即存）、点日期挪到那天（Live 配对跟着走）、随手贴/撕标签。共 {items.length} 张（照片 {photos} · 视频 {videos}）。
      </p>
      {tagLib.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-sm font-bold text-ink-soft">标签库：</span>
          {tagLib.map((t) => (
            <span key={t} className="flex items-center gap-1 rounded-full px-2 py-0.5 font-hand text-sm text-ink" style={{ background: tagColor(t) }}>
              {t}
              <button
                type="button"
                onClick={() => onDeleteTag(t)}
                aria-label={`删掉标签 ${t}`}
                title="从标签库删掉（所有照片上都会一起撕掉）"
                className="grid size-3.5 place-items-center rounded-full bg-ink/10 transition hover:bg-ink/25"
              >
                <X weight="bold" className="size-2" />
              </button>
            </span>
          ))}
        </div>
      )}
      {items.map((m, i) => (
        <MediaRow
          key={`${m.id}-${m.entryDate ?? ""}`}
          item={m}
          tagLib={tagLib}
          onPatched={onPatched}
          onOpen={() => setZoom(i)}
          onDelete={() => onDeleteItem(m.id)}
        />
      ))}
      {items.length === 0 && <p className="card-paper py-10 text-center text-ink-soft">相册还空着</p>}
      <Lightbox
        photos={items.map((m) => ({ ...m, entryDate: m.entryDate ?? "" }) as LightboxPhoto)}
        index={zoom}
        onClose={() => setZoom(null)}
        onNav={setZoom}
      />
    </div>
  );
}

function DashboardInner({
  initialEntries,
  settings,
  initialEggs,
  initialMilestones,
  album,
  allTags: initialTagLib,
  initialType: initialTypeRaw,
  initialTab: initialTabRaw,
  initialFilter: initialFilterRaw,
  editId,
}: {
  initialEntries: EntryDTO[];
  settings: SiteSettings;
  initialEggs: EggDTO[];
  initialMilestones: MilestoneDTO[];
  album: AlbumPickItem[];
  /** 全局标签库（任何地方输入过的标签都在这儿） */
  allTags: string[];
  /** URL 参数在服务端读好传进来：?type= 直达新增模块 / ?tab= 直达标签 / ?edit= 直达编辑 */
  initialType?: string;
  initialTab?: string;
  /** ?filter= 直达「本子里的一切」某个分类 */
  initialFilter?: string;
  editId?: string;
}) {
  const toast = useToast();
  // ?type=quote 直达对应新增模块（含大事记 / 彩蛋）
  const initialType = TYPE_KEYS.includes(initialTypeRaw as FormKind) ? (initialTypeRaw as FormKind) : undefined;
  const initialTab = TAB_KEYS.includes(initialTabRaw as Tab) ? (initialTabRaw as Tab) : "write";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [entries, setEntries] = useState<EntryDTO[]>(initialEntries);
  const [milestones, setMilestones] = useState<MilestoneDTO[]>(initialMilestones);
  const [eggs, setEggs] = useState<EggDTO[]>(initialEggs);
  const [albumItems, setAlbumItems] = useState(album);
  // 新建手账页的两种写法：文字表单 / 自由拼贴画板（只在选「手账页」时出现）
  const [pageMode, setPageMode] = useState<"form" | "board">("form");
  const [formType, setFormType] = useState<FormKind>(initialType ?? "journal");
  // 保存过一页后让新建画板 / 大事记 / 彩蛋表单重置成空白
  const [boardSeq, setBoardSeq] = useState(0);
  const [milestoneSeq, setMilestoneSeq] = useState(0);
  const [eggSeq, setEggSeq] = useState(0);
  // ?edit=id 时直接进入编辑（惰性初始化，避免 effect 里 setState）
  const [editing, setEditing] = useState<EntryDTO | null>(() =>
    editId ? (initialEntries.find((e) => e.id === editId) ?? null) : null
  );
  const [editingMilestone, setEditingMilestone] = useState<MilestoneDTO | null>(null);
  const [editingEgg, setEditingEgg] = useState<EggDTO | null>(null);
  // 本子里的一切：筛选（?filter= 服务端读好传进来）
  const [filter, setFilter] = useState<FilterValue>((FILTERS.some((f) => f.value === initialFilterRaw) ? initialFilterRaw : "all") as FilterValue);
  // 批量设置公开性：勾一排历史内容一次放开/收回（照片是按张管理的，批量去「全部」里勾照片页）
  const [batch, setBatch] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  // 所在的位置（标签页 + 分类）写进地址栏：刷新/分享链接都能回到这里，不用从头点
  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "write") params.set("tab", tab);
    if (tab === "list" && filter !== "all") params.set("filter", filter);
    const q = params.toString();
    try {
      window.history.replaceState(null, "", q ? `/write?${q}` : "/write");
    } catch {
      /* 极老浏览器就算了 */
    }
  }, [tab, filter]);

  const refreshAll = useCallback(async () => {
    const [e, m, g] = await Promise.all([
      fetch("/api/entries").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/milestones").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/eggs").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (e) setEntries(e.entries as EntryDTO[]);
    if (m) setMilestones(m.milestones as MilestoneDTO[]);
    if (g) setEggs(g.eggs as EggDTO[]);
  }, []);

  /** 按张管理改完一张（描述/日期/标签）后同步素材列表；挪日期的顺手刷新条目列表；新标签顺手进标签库 */
  function patchAlbumItem(id: string, patch: Partial<AlbumPickItem>) {
    setAlbumItems((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    if (patch.tags) setTagLib((prev) => [...new Set([...prev, ...patch.tags!])].sort((a, b) => (a < b ? -1 : 1)));
    if (patch.entryDate !== undefined) void refreshAll();
  }

  /** 按张删一张：本地列表立刻移掉，条目列表刷新（空页会被回收） */
  async function deleteAlbumItem(id: string) {
    const res = await fetch(`/api/media/${id}?force=1`, { method: "DELETE" }).catch(() => null);
    if (res && res.ok) {
      setAlbumItems((prev) => prev.filter((a) => a.id !== id));
      void refreshAll();
      toast("已删掉这张");
    } else {
      toast("没删掉，再试一次？", "error");
    }
  }

  /** 全局删一个标签：库里、所有照片/页面上、本地状态里一起清掉 */
  async function deleteTagGlobally(name: string) {
    if (!window.confirm(`确定删掉标签「${name}」吗？会把它从所有照片和筛选里一起撕掉`)) return;
    const res = await fetch(`/api/tags/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => null);
    if (res && res.ok) {
      setTagLib((prev) => prev.filter((t) => t !== name));
      setAlbumItems((prev) => prev.map((a) => ({ ...a, tags: (a.tags ?? []).filter((t) => t !== name) })));
      setEntries((prev) => prev.map((e) => ({ ...e, tags: (e.tags ?? []).filter((t) => t !== name) })));
      toast(`标签「${name}」已删掉`);
    } else {
      toast("没删掉，再试一次？", "error");
    }
  }

  function onSaved(entry: EntryDTO, isNew: boolean) {
    toast(isNew ? `已贴进手账 · ${entry.entry_date.replaceAll("-", ".")}` : "改好了，已保存");
    setEditing(null);
    setBoardSeq((s) => s + 1);
    setTab("list");
    void refreshAll();
  }

  function onMilestoneSaved() {
    setEditingMilestone(null);
    setMilestoneSeq((s) => s + 1);
    setTab("list");
    void refreshAll();
  }

  function onEggSaved() {
    setEditingEgg(null);
    setEggSeq((s) => s + 1);
    setTab("list");
    void refreshAll();
  }

  async function onDeleteEntry(entry: EntryDTO) {
    const hint = entry.title || entry.body.slice(0, 12) || TYPE_META[entry.type].label;
    if (!window.confirm(`确定删掉「${hint}」吗？连照片一起删哦`)) return;
    const res = await fetch(`/api/entries/${entry.id}`, { method: "DELETE" }).catch(() => null);
    if (res && res.ok) {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      if (editing?.id === entry.id) setEditing(null);
      toast("已删掉这一页");
    } else {
      toast("删除失败，再试一次？", "error");
    }
  }

  /** 列表上的快捷开关：这一页对访客公开 / 仅她可见 */
  async function toggleEntryVisibility(entry: EntryDTO) {
    const next = entry.visibility === "public" ? "private" : "public";
    const res = await fetch(`/api/entries/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    }).catch(() => null);
    if (res && res.ok) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, visibility: next } : e)));
      toast(next === "public" ? "这一页对访客公开了" : `这一页收回来，只有${READER_NAME}能看`);
    } else {
      toast("没改上，再试一次？", "error");
    }
  }

  /** 大事记的同一枚开关 */
  async function toggleMilestoneVisibility(m: MilestoneDTO) {
    const next = m.visibility === "public" ? "private" : "public";
    const res = await fetch(`/api/milestones/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    }).catch(() => null);
    if (res && res.ok) {
      setMilestones((prev) => prev.map((x) => (x.id === m.id ? { ...x, visibility: next } : x)));
      toast(next === "public" ? "这条大事记对访客公开了" : `这条大事记收回来，只有${READER_NAME}能看`);
    } else {
      toast("没改上，再试一次？", "error");
    }
  }

  /** 批量模式：勾/取消一行 */
  function togglePicked(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 一键把当前筛选下能勾的行全部勾上/清空 */
  function pickAllVisible(visible: Row[]) {
    const ids = visible.filter((r) => r.t !== "egg").map((r) => (r.t === "entry" ? r.entry.id : r.milestone.id));
    setPicked((prev) => {
      const next = new Set(prev);
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  /** 批量应用公开/仅她，本地状态同步更新 */
  async function applyBatch(visibility: "public" | "private") {
    if (batchBusy || picked.size === 0) return;
    setBatchBusy(true);
    const entryIds = entries.filter((e) => picked.has(e.id)).map((e) => e.id);
    const milestoneIds = milestones.filter((m) => picked.has(m.id)).map((m) => m.id);
    try {
      const res = await fetch("/api/visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds, milestoneIds, visibility }),
      });
      const data = (await res.json().catch(() => ({}))) as { entries?: number; milestones?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "没改上");
      setEntries((prev) => prev.map((e) => (picked.has(e.id) ? { ...e, visibility } : e)));
      setMilestones((prev) => prev.map((m) => (picked.has(m.id) ? { ...m, visibility } : m)));
      toast(
        visibility === "public"
          ? `已放开 ${(data.entries ?? 0) + (data.milestones ?? 0)} 项，访客能看了`
          : `已收回 ${(data.entries ?? 0) + (data.milestones ?? 0)} 项，只剩${READER_NAME}能看`
      );
      setPicked(new Set());
    } catch (e) {
      toast(e instanceof Error ? e.message : "没改上，再试一次？", "error");
    } finally {
      setBatchBusy(false);
    }
  }

  async function onDeleteMilestone(m: MilestoneDTO) {
    if (!window.confirm(`确定删掉「${m.title}」这条大事记吗？照片和视频会留在相册里`)) return;
    const res = await fetch(`/api/milestones/${m.id}`, { method: "DELETE" }).catch(() => null);
    if (res && res.ok) {
      setMilestones((prev) => prev.filter((x) => x.id !== m.id));
      if (editingMilestone?.id === m.id) setEditingMilestone(null);
      toast("已删掉这条大事记");
    } else {
      toast("删除失败，再试一次？", "error");
    }
  }

  async function onDeleteEgg(egg: EggDTO) {
    if (!window.confirm(`确定删掉彩蛋「${egg.title}」吗？她留下的留言也会一起删掉`)) return;
    const res = await fetch(`/api/eggs/${egg.id}`, { method: "DELETE" }).catch(() => null);
    if (res && res.ok) {
      setEggs((prev) => prev.filter((e) => e.id !== egg.id));
      if (editingEgg?.id === egg.id) setEditingEgg(null);
      toast("彩蛋已删除");
    } else {
      toast("删除失败，再试一次？", "error");
    }
  }

  async function copyEggLink(egg: EggDTO) {
    const url = `${window.location.origin}/someday/${egg.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("链接已复制，到时候发给她");
    } catch {
      toast(url);
    }
  }

  function goEditEntry(entry: EntryDTO) {
    setEditing(entry);
    setEditingMilestone(null);
    setEditingEgg(null);
    setTab("write");
    window.scrollTo({ top: 0 });
  }

  function goEditMilestone(m: MilestoneDTO) {
    setEditingMilestone(m);
    setEditing(null);
    setEditingEgg(null);
    setTab("write");
    window.scrollTo({ top: 0 });
  }

  function goEditEgg(egg: EggDTO) {
    setEditingEgg(egg);
    setEditing(null);
    setEditingMilestone(null);
    setTab("write");
    window.scrollTo({ top: 0 });
  }

  // 统一列表：条目 + 大事记 + 彩蛋，按日期倒序
  const rows = useMemo<Row[]>(() => {
    const all: Row[] = [
      ...entries.map((e) => ({ t: "entry" as const, kind: (e.type === "board" ? "journal" : e.type) as FilterValue, date: e.entry_date, entry: e })),
      ...milestones.map((m) => ({ t: "milestone" as const, kind: "milestone" as const, date: m.date, milestone: m })),
      ...eggs.map((g) => ({ t: "egg" as const, kind: "egg" as const, date: g.revealDate, egg: g })),
    ];
    return all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [entries, milestones, eggs]);
  const visibleRows = filter === "all" ? rows : rows.filter((r) => r.kind === filter);

  // 本子里用过的标签：表单里「常用」建议用（全局标签库，随输入/删除实时变）
  const [tagLib, setTagLib] = useState(initialTagLib);

  const editingSomething = editing || editingMilestone || editingEgg;

  return (
    <div className="mx-auto max-w-3xl py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">写手账</h1>
        <Link href="/" className="link-soft text-sm">
          回到手账
          <ArrowRight weight="bold" className="size-3.5" />
        </Link>
      </header>

      {/* 工作台标签 */}
      <div className="mt-7 flex gap-2 overflow-x-auto no-scrollbar">
        {(
          [
            { value: "write", label: editingSomething ? "改这一页" : "写一页", icon: PencilSimple, cls: "bg-rose-soft text-rose-deep" },
            { value: "list", label: "本子里的一切", icon: Stack, cls: "bg-mist text-ink" },
            { value: "settings", label: "本子信息", icon: GearSix, cls: "bg-butter text-ink" },
          ] as const
        ).map(({ value, label, icon: Icon, cls }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition-all duration-300 ease-spring",
              tab === value ? cn(cls, "-translate-y-px shadow-sm") : "border border-ink/15 text-ink-soft hover:bg-ink/5"
            )}
          >
            <Icon weight="bold" className="size-4" />
            {label}
          </button>
        ))}
        {/* 她盖过的章、寄回来的话：单独一页，只有作者能进 */}
        <Link
          href="/write/marks"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-rose-soft px-4 py-2 text-sm font-bold text-rose-deep transition-all duration-300 ease-spring hover:-translate-y-px"
        >
          <HeartStraight weight="fill" className="size-4" />
          她的痕迹
        </Link>
        {/* 访客记录：谁（IP/城市）什么时候来逛过 */}
        <Link
          href="/write/visitors"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-mist px-4 py-2 text-sm font-bold text-ink transition-all duration-300 ease-spring hover:-translate-y-px"
        >
          <GlobeHemisphereWest weight="fill" className="size-4" />
          访客记录
        </Link>
        {/* 放映室排片：纪念视频的首映管理 */}
        <Link
          href="/write/screenings"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-butter px-4 py-2 text-sm font-bold text-ink transition-all duration-300 ease-spring hover:-translate-y-px"
        >
          <FilmSlate weight="fill" className="size-4" />
          放映室排片
        </Link>
      </div>

      <div className="mt-7">
        {tab === "write" &&
          (editing ? (
            <div className="space-y-4">
              <p className="text-sm text-ink-soft">正在编辑 {editing.entry_date} 的这一页</p>
              {editing.type === "board" ? (
                <BoardEditor
                  key={editing.id}
                  initial={{
                    id: editing.id,
                    title: editing.title,
                    entryDate: editing.entry_date,
                    layout: (editing.layout as BoardLayout | null) ?? null,
                    mediaIds: editing.media.map((m) => m.id),
                  }}
                  onSaved={onSaved}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <EntryForm key={editing.id} initial={editing} album={albumItems} knownTags={tagLib} onTagDelete={(t) => void deleteTagGlobally(t)} onSaved={onSaved} onCancel={() => setEditing(null)} />
              )}
            </div>
          ) : editingMilestone ? (
            <div className="space-y-4">
              <p className="text-sm text-ink-soft">正在编辑「{editingMilestone.title}」这条大事记</p>
              <MilestoneForm
                initial={editingMilestone}
                album={albumItems}
                onSaved={onMilestoneSaved}
                onCancel={() => setEditingMilestone(null)}
                onAlbumGrow={(item) => setAlbumItems((prev) => [item, ...prev])}
              />
            </div>
          ) : editingEgg ? (
            <div className="space-y-4">
              <p className="text-sm text-ink-soft">正在编辑彩蛋「{editingEgg.title}」</p>
              <EggForm initial={editingEgg} album={albumItems} onSaved={onEggSaved} onCancel={() => setEditingEgg(null)} />
            </div>
          ) : (
            <div className="space-y-5">
              {/* 「手账页」专属：文字表单 / 自由画板 二选一；选了别的类型就收起来 */}
              {(pageMode === "board" || formType === "journal") && (
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { value: "form", label: "写一页 · 文字表单", icon: PencilSimple },
                      { value: "board", label: "拼一页 · 自由画板", icon: Sticker },
                    ] as const
                  ).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPageMode(value)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition-all duration-300 ease-spring",
                        pageMode === value
                          ? "-translate-y-px bg-rose-soft text-rose-deep shadow-sm"
                          : "border border-ink/15 text-ink-soft hover:bg-ink/5"
                      )}
                    >
                      <Icon weight="bold" className="size-4" />
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {/* 文字表单（含 6 张类型卡）；两个都保持挂载、按需显隐：切来切去不丢草稿 */}
              <div className={pageMode === "board" ? "hidden" : undefined}>
                <EntryForm onSaved={onSaved} onTypeChange={setFormType} type={formType} album={albumItems} knownTags={tagLib} onTagDelete={(t) => void deleteTagGlobally(t)} />
              </div>
              {/* 大事记 / 彩蛋表单（类型卡选到它们时出现） */}
              {pageMode === "form" && formType === "milestone" && (
                <MilestoneForm
                  key={milestoneSeq}
                  album={albumItems}
                  onSaved={onMilestoneSaved}
                  onCancel={() => setFormType("journal")}
                  onAlbumGrow={(item) => setAlbumItems((prev) => [item, ...prev])}
                />
              )}
              {pageMode === "form" && formType === "egg" && (
                <EggForm key={eggSeq} album={albumItems} onSaved={onEggSaved} onCancel={() => setFormType("journal")} />
              )}
              <div className={pageMode === "board" ? undefined : "hidden"}>
                <BoardEditor key={boardSeq} onSaved={onSaved} />
              </div>
            </div>
          ))}

        {tab === "list" && (
          <div className="space-y-4">
            <p className="px-1 text-sm leading-relaxed text-ink-soft">
              这本本子的全部记忆——写下的、拍下的、贴上的、埋下的，都在这儿了，随手翻、随手改。
            </p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {FILTERS.map(({ value, label }) => {
                const n = value === "all" ? rows.length : value === "photo" ? albumItems.length : rows.filter((r) => r.kind === value).length;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-sm font-bold transition-all duration-300 ease-spring",
                      filter === value ? "-translate-y-px bg-rose-soft text-rose-deep shadow-sm" : "border border-ink/15 text-ink-soft hover:bg-ink/5"
                    )}
                  >
                    {label}
                    <span className="font-round text-[11px] tracking-wider opacity-70">{n}</span>
                  </button>
                );
              })}
              {/* 批量设置公开性：相册筛选下按天成页来勾（平时是按张管理的媒体视图，批量时切成日期页行） */}
              {!batch && (
                <button
                  type="button"
                  onClick={() => setBatch(true)}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-ink/25 px-3.5 py-1.5 text-sm font-bold text-ink-soft transition hover:border-rose hover:text-rose-deep"
                >
                  <Checks className="size-4" weight="bold" />
                  批量设置公开性
                </button>
              )}
            </div>

            {/* 批量操作条：全选当前筛选 → 设为公开 / 收回 */}
            {batch && (
              <div className="card-paper flex flex-wrap items-center gap-2 px-4 py-3">
                <button
                  type="button"
                  onClick={() => pickAllVisible(visibleRows)}
                  className="flex items-center gap-1.5 rounded-full border border-ink/15 px-3.5 py-1.5 text-sm font-bold text-ink-soft transition hover:bg-ink/5 hover:text-ink"
                >
                  {(() => {
                    const ids = visibleRows.filter((r) => r.t !== "egg").map((r) => (r.t === "entry" ? r.entry.id : r.milestone.id));
                    const allOn = ids.length > 0 && ids.every((id) => picked.has(id));
                    return allOn ? <CheckCircle weight="fill" className="size-4 text-rose-deep" /> : <Circle className="size-4" />;
                  })()}
                  全选当前列表
                </button>
                <span className="font-round text-sm tracking-wider text-ink-soft">
                  已选 {picked.size} 项{batchBusy ? " · 正在改…" : ""}
                </span>
                <span className="ml-auto" />
                <button
                  type="button"
                  onClick={() => void applyBatch("public")}
                  disabled={picked.size === 0 || batchBusy}
                  className="btn-primary px-4 py-2 text-sm"
                >
                  <Eye weight="bold" className="size-4" />
                  设为公开
                </button>
                <button
                  type="button"
                  onClick={() => void applyBatch("private")}
                  disabled={picked.size === 0 || batchBusy}
                  className="btn-ghost px-4 py-2 text-sm"
                >
                  <EyeSlash weight="bold" className="size-4" />
                  收回为仅{READER_NAME}可见
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBatch(false);
                    setPicked(new Set());
                  }}
                  className="grid size-8 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink"
                  aria-label="退出批量设置"
                >
                  <X className="size-4" weight="bold" />
                </button>
              </div>
            )}

            {visibleRows.length === 0 && (filter !== "photo" || batch) && (
              <p className="card-paper py-10 text-center text-ink-soft">
                {rows.length === 0 ? "本子还空着，先写一页吧" : "这一类还没有内容"}
              </p>
            )}

            {/* 相册：不按天分组，按张管理（描述/日期/标签当场改）；批量模式切到下面的日期页行 */}
            {filter === "photo" && !batch && (
              <MediaManager
                items={albumItems}
                tagLib={tagLib}
                onDeleteTag={(t) => void deleteTagGlobally(t)}
                onPatched={patchAlbumItem}
                onDeleteItem={(id) => void deleteAlbumItem(id)}
              />
            )}

            {/* 批量模式下相册按天成页勾选，给一句提示免得误会勾的是单张 */}
            {batch && filter === "photo" && (
              <p className="px-1 text-xs leading-relaxed text-ink-soft">
                照片按天自动成页：勾选并公开某一天 = 那天的一整组照片都对访客可见
              </p>
            )}

            {(filter !== "photo" || batch) && visibleRows.map((row) => {
              if (row.t === "entry") {
                const e = row.entry;
                const meta = TYPE_META[e.type] ?? TYPE_META.journal;
                return (
                  <div key={e.id}>
                    <div
                      className={cn(
                        "card-paper flex items-center gap-4 px-5 py-4 transition",
                        batch && "cursor-pointer hover:border-rose/40",
                        batch && picked.has(e.id) && "border-rose-deep/50 bg-rose-soft/20"
                      )}
                      onClick={batch ? () => togglePicked(e.id) : undefined}
                    >
                      {batch && <PickBox on={picked.has(e.id)} onClick={() => togglePicked(e.id)} label={`选中 ${e.title ?? "这一页"}`} />}
                      <ListThumb entry={e} meta={meta} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">
                          {e.title || e.body.replace(/\*\*/g, "").slice(0, 20) || `${meta.label} · ${e.media.length} 个文件`}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-round text-xs tracking-wider text-ink-soft">
                          <span>
                            {e.entry_date.replaceAll("-", ".")} · {meta.label}
                            {e.media.length > 0 && ` · ${e.media.length} 个文件`}
                          </span>
                          <button
                            type="button"
                            onClick={() => void toggleEntryVisibility(e)}
                            title={e.visibility === "public" ? "访客也能看这一页，点一下收回来" : `只有${READER_NAME}能看，点一下对访客公开（栏目要也开了公开才生效）`}
                            className={cn(
                              "rounded-full px-2 py-0.5 font-bold transition",
                              e.visibility === "public" ? "bg-matcha/50 text-ink" : "bg-ink/8 text-ink-soft"
                            )}
                          >
                            {e.visibility === "public" ? "访客可见" : `仅${READER_NAME}可见`}
                          </button>
                          {isScheduled(e) && (
                            <span className="rounded-full bg-butter px-2 py-0.5 font-bold text-ink">
                              定时 {e.reveal_at!.replaceAll("-", ".")} 才可见
                            </span>
                          )}
                          {(e.tags ?? []).map((t) => (
                            <span key={t} className="rounded-full px-1.5 py-0.5 font-hand text-xs text-ink" style={{ background: tagColor(t) }}>
                              {t}
                            </span>
                          ))}
                        </p>
                        {e.created_at && (
                          <p className="mt-1 font-round text-[10px] tracking-wider text-ink-soft/60">
                            创建 {fmtCST(e.created_at)}
                            {e.updated_at && e.updated_at !== e.created_at && ` · 改于 ${fmtCST(e.updated_at)}`}
                          </p>
                        )}
                      </div>
                      {!batch && (
                        <button
                          type="button"
                          onClick={() => goEditEntry(e)}
                          aria-label="编辑"
                          className="grid size-9 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink"
                        >
                          <PencilSimple className="size-4" />
                        </button>
                      )}
                      {!batch && (
                        <button
                          type="button"
                          onClick={() => void onDeleteEntry(e)}
                          aria-label="删除"
                          className="grid size-9 place-items-center rounded-full text-ink-soft transition hover:bg-rose-soft hover:text-rose-deep"
                        >
                          <TrashSimple className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              }
              if (row.t === "milestone") {
                const m = row.milestone;
                return (
                  <div key={m.id}>
                    <div
                      className={cn(
                        "card-paper flex items-center gap-4 px-5 py-4 transition",
                        batch && "cursor-pointer hover:border-rose/40",
                        batch && picked.has(m.id) && "border-rose-deep/50 bg-rose-soft/20"
                      )}
                      onClick={batch ? () => togglePicked(m.id) : undefined}
                    >
                      {batch && <PickBox on={picked.has(m.id)} onClick={() => togglePicked(m.id)} label={`选中 ${m.title}`} />}
                      <span
                        className={cn(
                          "grid size-11 shrink-0 place-items-center rounded-xl bg-butter text-ink",
                          !(m.icon && STICKER_NAMES.includes(m.icon as StickerName)) && "text-ink"
                        )}
                      >
                        {m.icon && STICKER_NAMES.includes(m.icon as StickerName) ? (
                          <StickerBadge name={m.icon as StickerName} className="size-5" />
                        ) : (
                          <FlagBanner weight="fill" className="size-5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{m.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-round text-xs tracking-wider text-ink-soft">
                          <span>
                            {m.date.replaceAll("-", ".")} · 大事记
                            {m.mediaIds.length > 0 && ` · ${m.mediaIds.length} 个照片/视频`}
                          </span>
                          <button
                            type="button"
                            onClick={() => void toggleMilestoneVisibility(m)}
                            title={m.visibility === "public" ? "访客也能看这条，点一下收回来" : `只有${READER_NAME}能看，点一下对访客公开（栏目要也开了公开才生效）`}
                            className={cn(
                              "rounded-full px-2 py-0.5 font-bold transition",
                              m.visibility === "public" ? "bg-matcha/50 text-ink" : "bg-ink/8 text-ink-soft"
                            )}
                          >
                            {m.visibility === "public" ? "访客可见" : `仅${READER_NAME}可见`}
                          </button>
                        </p>
                        {m.createdAt && (
                          <p className="mt-1 font-round text-[10px] tracking-wider text-ink-soft/60">
                            创建 {fmtCST(m.createdAt)}
                            {m.updatedAt && m.updatedAt !== m.createdAt && ` · 改于 ${fmtCST(m.updatedAt)}`}
                          </p>
                        )}
                      </div>
                      {!batch && (
                        <button
                          type="button"
                          onClick={() => goEditMilestone(m)}
                          aria-label="编辑"
                          className="grid size-9 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink"
                        >
                          <PencilSimple className="size-4" />
                        </button>
                      )}
                      {!batch && (
                        <button
                          type="button"
                          onClick={() => void onDeleteMilestone(m)}
                          aria-label="删除"
                          className="grid size-9 place-items-center rounded-full text-ink-soft transition hover:bg-rose-soft hover:text-rose-deep"
                        >
                          <TrashSimple className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              }
              const g = row.egg;
              const doodleCount = Object.values(g.doodles ?? {}).reduce((a, b) => a + b, 0);
              return (
                <div key={g.id}>
                  <div className="card-paper flex items-center gap-4 px-5 py-4">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-rose-soft text-rose-deep">
                      <Gift weight="fill" className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{g.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-round text-xs tracking-wider text-ink-soft">
                        <span>
                          {g.revealDate.replaceAll("-", ".")} · 彩蛋 · {g.photoIds.length} 张照片
                          {doodleCount > 0 && ` · 她留了 ${doodleCount} 句话`}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 font-bold",
                            isEggArrived(g) ? "bg-matcha/50 text-ink" : "bg-butter/60 text-ink"
                          )}
                        >
                          {isEggArrived(g) ? "到日子啦，可以打开" : "封印中，没到日子"}
                        </span>
                      </p>
                    </div>
                    <a
                      href={`/someday/${g.id}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="打开彩蛋看她的留言"
                      title="打开彩蛋：有「有话」角标的照片上叠着她画的话"
                      className="grid size-9 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink"
                    >
                      <Eye className="size-4" />
                    </a>
                    <button
                      type="button"
                      onClick={() => void copyEggLink(g)}
                      aria-label="复制彩蛋链接"
                      title="复制彩蛋链接"
                      className="grid size-9 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink"
                    >
                      <Copy className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => goEditEgg(g)}
                      aria-label="编辑"
                      className="grid size-9 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink"
                    >
                      <PencilSimple className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteEgg(g)}
                      aria-label="删除"
                      className="grid size-9 place-items-center rounded-full text-ink-soft transition hover:bg-rose-soft hover:text-rose-deep"
                    >
                      <TrashSimple className="size-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "settings" && <SettingsForm initial={settings} />}
      </div>
    </div>
  );
}

export function WriteDashboard(props: {
  initialEntries: EntryDTO[];
  settings: SiteSettings;
  initialEggs: EggDTO[];
  initialMilestones: MilestoneDTO[];
  album: AlbumPickItem[];
  /** 全局标签库 */
  allTags: string[];
  /** URL 参数由服务端页面读好传入（?type / ?tab / ?edit） */
  initialType?: string;
  initialTab?: string;
  /** ?filter= 直达「本子里的一切」某个分类 */
  initialFilter?: string;
  editId?: string;
}) {
  return <DashboardInner {...props} />;
}

/* hmr-probe */
