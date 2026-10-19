"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowLeft,
  CalendarBlank,
  Camera,
  Check,
  EnvelopeSimple,
  Eye,
  EyeSlash,
  FlagBanner,
  FolderOpen,
  Gift,
  ImageSquare,
  Images,
  Link,
  Notebook,
  ChatTeardropText,
  SpinnerGap,
  UploadSimple,
  VideoCamera,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/Toast";
import { indentOnTab } from "@/lib/indent";
import { readTakenAt } from "@/lib/media-date";
import { tiltOf } from "@/lib/tilt";
import { MAX_TAGS_PER_ENTRY, TAG_MAX_LEN, tagColor } from "@/lib/tags";
import { STICKER_NAMES, Sticker, type StickerName } from "@/components/journal/Sticker";
import { shrinkImage, uploadFile, expandLivp, fileFingerprint, lookupFingerprints, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, type MediaDTO } from "@/lib/client-upload";
import { VoiceRecorder, type VoiceDraft } from "./VoiceRecorder";
import { TagDropdown } from "./TagDropdown";
import { AlbumPickThumb } from "./AlbumPickThumb";
import type { AlbumPickItem } from "./MilestoneManager";
import { READER_NAME } from "@/lib/reader";

export type { MediaDTO };

export type EntryDTO = {
  id: string;
  type: "journal" | "photo" | "quote" | "letter" | "board";
  title: string | null;
  body: string;
  speaker: string | null;
  mood: string | null;
  entry_date: string;
  reveal_at: string | null;
  media: MediaDTO[];
  layout?: unknown;
  /** 相册标签（「青海之行」这类） */
  tags?: string[];
  /** 访客模式：public = 不登录也能看这一页；private/缺省 = 仅她 */
  visibility?: "public" | "private";
  /** 入库/最后修改时间（ISO）：后台「本子里的一切」展示用 */
  created_at?: string;
  updated_at?: string;
};

type PickItem = {
  key: string;
  existing?: MediaDTO;
  file?: File;
  previewUrl: string;
  caption: string;
  kind: "photo" | "video";
  width?: number;
  height?: number;
  /** 本浏览器放不了这个预览（HEVC 视频 / 解不了 HEIC 的浏览器） */
  previewBroken?: boolean;
  /** 视频是 HEVC 编码（字节级嗅探，不依赖浏览器能不能解） */
  hevc?: boolean | null;
  /** 文件的真实拍摄日期（EXIF / 视频元数据 / 修改时间兜底）；存照片按它自动分页 */
  takenAt?: string | null;
  /** 手动改过的日期（卡片上的日期输入框）：存照片分页时优先于拍摄日期 */
  userDate?: string;
  /** Live Photo：照片指向配对视频的 item key */
  pairVideoKey?: string;
  /** 视频被某张照片配对（只显示提示，不单独展示） */
  pairedTo?: string;
  /** 从本子里引用来的（不是这条目自己的文件，保存时走 ref_media） */
  fromRef?: boolean;
  /** 已传过（内容指纹命中）：灰掉、不上传也不保存 */
  dup?: { id: string; kind: "photo" | "video"; thumbUrl: string | null; entryDate: string | null; caption: string | null };
  /** 疑似重复：同一张导出/下载两遍会带「(1)」后缀且字节被重编码过，指纹对不上，只能靠名字认出来。
   *  和 dup 一样灰掉不上传，但可一键「仍然要传」 */
  dupSuspect?: boolean;
  /** 同一批里选进来的完全相同文件（指纹一致）：dup.id 为空、dupBatchName 记第一份的文件名 */
  dupBatchName?: string;
  /** 内容指纹（大小-头尾sha256），探测阶段算好，上传时随 complete 入库 */
  fp?: string;
};

/** 单个文件的后台上传状态（放在 ref 里，变化时 bump 触发重渲染） */
type UpState = {
  status: "waiting" | "uploading" | "done" | "error" | "cancelled";
  pct: number;
  error?: string;
  /** true = 重传也没用（比如超过大小上限），不给重传按钮 */
  fatal?: boolean;
  dto?: MediaDTO;
  controller: AbortController;
  promise: Promise<MediaDTO>;
};

/** 从拖拽事件里收集文件：支持直接拖文件，也支持拖整个文件夹（递归读子目录）。
 *  webkitGetAsEntry 必须在事件让出主线程前同步调完，所以先同步映射 entries 再异步走目录 */
async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const entries = Array.from(dt.items ?? []).map((i) =>
    typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null
  );
  if (entries.some(Boolean)) {
    const walk = async (entry: FileSystemEntry | null): Promise<void> => {
      if (!entry) return;
      if (entry.isFile) {
        await new Promise<void>((res) =>
          (entry as FileSystemFileEntry).file(
            (f) => {
              out.push(f);
              res();
            },
            () => res()
          )
        );
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const readBatch = () =>
          new Promise<FileSystemEntry[]>((res) => reader.readEntries((es) => res(es), () => res([])));
        let batch = await readBatch(); // readEntries 每次最多吐 100 条，读到空为止
        while (batch.length > 0) {
          for (const e of batch) await walk(e);
          batch = await readBatch();
        }
      }
    };
    await Promise.all(entries.map(walk));
  } else {
    out.push(...Array.from(dt.files ?? []));
  }
  return out;
}

/** 并发闸门：传文件一次最多 6 个（OSS 走 HTTP/2 多路复用，6 路能把带宽吃满）、
 *  探元信息一次最多 8 个（指纹哈希是几百个文件时的大头），几百个的文件夹也不至于拖到天黑 */
function makeSemaphore(limit: number) {
  let active = 0;
  const waiters: (() => void)[] = [];
  return {
    acquire: () =>
      new Promise<void>((resolve) => {
        if (active < limit) {
          active += 1;
          resolve();
        } else {
          waiters.push(() => {
            active += 1;
            resolve();
          });
        }
      }),
    release: () => {
      active -= 1;
      waiters.shift()?.();
    },
  };
}
const uploadSem = makeSemaphore(6);
const metaSem = makeSemaphore(8);

/** 预览区一次最多渲染多少张卡：更多先不渲染（滚到底自动续），几百个缩略图一起解码会把浏览器卡死 */
const RENDER_CHUNK = 60;

/** 写一页里可选的内容类型：前四个走本表单；大事记/彩蛋是外部表单，选中后由外层渲染 */
export type FormKind = EntryDTO["type"] | "milestone" | "egg";

const TYPES: { value: FormKind; label: string; icon: typeof Notebook; hint: string }[] = [
  { value: "journal", label: "手账页", icon: Notebook, hint: "写一段今天，配上照片" },
  { value: "photo", label: "存照片", icon: Images, hint: "批量传，只进拍立得墙" },
  { value: "quote", label: "存语录", icon: ChatTeardropText, hint: "可爱话，还能录语音" },
  { value: "letter", label: "写信", icon: EnvelopeSimple, hint: "封进信箱，可定时" },
  { value: "milestone", label: "大事记", icon: FlagBanner, hint: "钉在时间轴上的大事" },
  { value: "egg", label: "彩蛋", icon: Gift, hint: "到日子才开的惊喜" },
];

const MOOD_COLORS: Record<StickerName, string> = {
  heart: "text-rose",
  star: "text-butter",
  flower: "text-matcha",
  cloud: "text-mist",
  coffee: "text-peach",
  music: "text-rose-deep",
  plane: "text-mist",
  camera: "text-ink-soft",
  gift: "text-rose",
  cake: "text-peach",
  icecream: "text-rose-deep",
  cat: "text-peach",
  sparkle: "text-butter",
  sun: "text-butter",
  moon: "text-mist",
  confetti: "text-rose-deep",
};

function todayStr(): string {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
}

let keySeq = 0;
const localKey = () => `pick-${Date.now()}-${keySeq++}`;
const baseName = (name: string) => name.replace(/\.[^.]+$/, "").toUpperCase();

/** 从 mp4/mov 字节里嗅探编码：HEVC（hvc1/hev1/dvh1/dvhe）还是 H.264（avc1）。
 *  只扫文件头尾（moov 盒要么在头要么在尾），不用解码，浏览器解不了也能判断 */
async function sniffHevc(file: File): Promise<boolean | null> {
  try {
    const slices: ArrayBuffer[] = [await file.slice(0, 1_000_000).arrayBuffer()];
    if (file.size > 1_500_000) {
      slices.push(await file.slice(Math.max(1_000_000, file.size - 12_000_000)).arrayBuffer());
    }
    let sawHevc = false;
    let sawAvc = false;
    for (const buf of slices) {
      const b = new Uint8Array(buf);
      for (let i = 0; i + 4 <= b.length; i++) {
        const c = b[i];
        if (c !== 0x68 && c !== 0x64 && c !== 0x61) continue; // 'h' 'd' 'a'
        const tag = String.fromCharCode(c, b[i + 1], b[i + 2], b[i + 3]);
        if (tag === "hvc1" || tag === "hev1" || tag === "dvh1" || tag === "dvhe") sawHevc = true;
        else if (tag === "avc1") sawAvc = true;
      }
    }
    if (sawHevc && !sawAvc) return true;
    if (sawAvc && !sawHevc) return false;
    return null;
  } catch {
    return null;
  }
}

/** 读视频元信息拿宽高（浏览器解不了 HEVC 时拿不到，返回空对象不碍事） */
async function probeVideoSize(file: File): Promise<{ width?: number; height?: number }> {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.src = url;
    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new Error("metadata"));
      setTimeout(() => reject(new Error("timeout")), 8000);
    });
    return v.videoWidth && v.videoHeight ? { width: v.videoWidth, height: v.videoHeight } : {};
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 视频卡的懒加载预览：进视口才挂 <video>，几十个视频也不会同时拉元信息；
 *  浏览器放不了（桌面 Chrome 遇 HEVC）时退服务端抽的封面，总能认出是哪段 */
function LazyPreviewVideo({ src, poster, onError }: { src: string; poster?: string | null; onError: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || inView || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "500px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);
  return (
    <div ref={boxRef} className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-ink/5">
      {inView ? (
        broken && poster ? (
          /* eslint-disable-next-line @next/next/no-img-element -- 视频封面，带鉴权的接口地址 */
          <img src={poster} alt="视频封面" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <video
            src={src}
            poster={poster ?? undefined}
            controls
            muted
            playsInline
            preload="metadata"
            onError={() => (poster ? setBroken(true) : onError())}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )
      ) : (
        <div className="grid aspect-[4/3] w-full place-items-center text-ink-soft/50">
          <VideoCamera weight="duotone" className="size-7" />
        </div>
      )}
    </div>
  );
}

/** 卡片底部的上传状态条：排队 / 进度 / 传好 / 重传 */
function UploadChip({ st, onRetry }: { st: UpState | undefined; onRetry: () => void }) {
  if (!st || st.status === "waiting") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 font-round text-[11px] font-bold tracking-wider text-ink-soft/70">
        <SpinnerGap className="size-3 animate-spin" />
        {st ? "排队上传中…" : "读取文件信息…"}
      </p>
    );
  }
  if (st.status === "uploading") {
    return (
      <div className="mt-1.5">
        <div className="h-1 overflow-hidden rounded-full bg-ink/10">
          <div className="h-full rounded-full bg-rose transition-all" style={{ width: `${st.pct}%` }} />
        </div>
        <p className="mt-0.5 font-round text-[11px] font-bold tracking-wider text-ink-soft/70">上传中 {st.pct}%</p>
      </div>
    );
  }
  if (st.status === "done") {
    return (
      <p className="mt-1.5 flex items-center gap-1 font-round text-[11px] font-bold tracking-wider text-matcha">
        <Check weight="bold" className="size-3" />
        已传好
      </p>
    );
  }
  if (st.status === "error") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 font-round text-[11px] font-bold tracking-wider text-rose-deep">
        <span className="truncate" title={st.error ?? "没传上去"}>{st.error ?? "没传上去"}</span>
        {!st.fatal && (
          <button
            type="button"
            onClick={onRetry}
            className="flex shrink-0 items-center gap-1 rounded-full bg-rose-soft px-2 py-0.5 transition hover:opacity-80"
          >
            <ArrowClockwise weight="bold" className="size-3" />
            重传
          </button>
        )}
      </p>
    );
  }
  if (st.status === "cancelled") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 font-round text-[11px] font-bold tracking-wider text-ink-soft/70">
        <span>已取消（没传到服务器）</span>
        <button
          type="button"
          onClick={onRetry}
          className="flex shrink-0 items-center gap-1 rounded-full bg-rose-soft px-2 py-0.5 transition hover:opacity-80"
        >
          <ArrowClockwise weight="bold" className="size-3" />
          重传
        </button>
      </p>
    );
  }
  return null;
}

/** 标签输入：像贴纸一样的小彩签，回车（或逗号）添加，点 × 撕掉；
 *  回车的瞬间就进全局标签库（别处立刻能选到），建议条里的标签也能直接删 */
function TagField({
  tags,
  onChange,
  knownTags,
  onDeleteTag,
  disabled,
}: {
  tags: string[];
  onChange: (t: string[]) => void;
  knownTags: string[];
  /** 从标签库里全局删掉一个标签（所有照片上一起撕） */
  onDeleteTag?: (name: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  function add(raw: string) {
    const t = raw.trim().slice(0, TAG_MAX_LEN).trim();
    if (!t || tags.includes(t) || tags.length >= MAX_TAGS_PER_ENTRY) return;
    onChange([...tags, t]);
    // 立刻进全局标签库：别的地方马上能选到（表单就算最后不保存，标签也已经在了）
    void fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: t }),
    }).catch(() => undefined);
  }
  const suggestions = knownTags.filter((t) => !tags.includes(t)).slice(0, 8);
  return (
    <div className="mt-5">
      <p className="mb-1.5 text-sm font-bold text-ink-soft">贴个标签（像「青海之行」，相册里能按它筛）</p>
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 font-hand text-base text-ink shadow-sm"
            style={{ background: tagColor(t), transform: `rotate(${tiltOf(t, 2)}deg)` }}
          >
            {t}
            <button
              type="button"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              disabled={disabled}
              aria-label={`移除标签 ${t}`}
              className="grid size-4 place-items-center rounded-full bg-ink/10 transition hover:bg-ink/25"
            >
              <X weight="bold" className="size-2.5" />
            </button>
          </span>
        ))}
        <div className="relative min-w-36 flex-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => window.setTimeout(() => setSuggestOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "," || e.key === "，") {
                e.preventDefault();
                add(draft);
                setDraft("");
              } else if (e.key === "Backspace" && !draft && tags.length > 0) {
                onChange(tags.slice(0, -1));
              }
            }}
            disabled={disabled}
            placeholder={tags.length === 0 ? "输入后回车，比如：青海之行" : "再加一个（回车）"}
            className="w-full rounded-full border border-ink/15 bg-paper px-3.5 py-1.5 text-sm outline-none placeholder:text-ink-soft/50 focus:border-rose"
          />
          {suggestOpen && !disabled && (
            <TagDropdown
              all={knownTags}
              exclude={tags}
              typed={draft}
              onPick={(t) => {
                add(t);
                setDraft("");
              }}
            />
          )}
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-soft/70">标签库：</span>
          {suggestions.map((t) => (
            <span key={t} className="flex items-center rounded-full border border-dashed border-ink/25 transition hover:border-rose">
              <button type="button" disabled={disabled} onClick={() => add(t)} className="px-2.5 py-0.5 font-hand text-sm text-ink-soft">
                {t}
              </button>
              {onDeleteTag && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onDeleteTag(t)}
                  aria-label={`删掉标签 ${t}`}
                  title="从标签库里删掉（所有照片上都会一起撕掉）"
                  className="mr-1 grid size-3.5 place-items-center rounded-full text-ink-soft/60 transition hover:bg-rose-soft hover:text-rose-deep"
                >
                  <X weight="bold" className="size-2" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 同名自动配对：iOS「存储到文件」导出的 Live Photo 是 IMG_1234.HEIC + IMG_1234.MOV */
function autoPair(next: PickItem[]): number {
  const groups = new Map<string, PickItem[]>();
  for (const it of next) {
    if (!it.file) continue;
    const b = baseName(it.file.name);
    groups.set(b, [...(groups.get(b) ?? []), it]);
  }
  let paired = 0;
  for (const group of groups.values()) {
    const photos = group.filter((g) => g.kind === "photo" && !g.pairVideoKey);
    const videos = group.filter((g) => g.kind === "video" && !g.pairedTo);
    if (photos.length === 1 && videos.length === 1) {
      photos[0].pairVideoKey = videos[0].key;
      videos[0].pairedTo = photos[0].key;
      paired++;
    }
  }
  return paired;
}

/** 写作表单：新建或编辑一页。选「大事记 / 彩蛋」时只渲染类型卡（表单由外层换成对应组件） */
export function EntryForm({
  initial,
  type: typeProp,
  album = [],
  knownTags = [],
  onTagDelete,
  onSaved,
  onCancel,
  onTypeChange,
}: {
  initial?: EntryDTO | null;
  /** 受控类型（新建时由工作台持有，切换/取消外部表单都要动它）；编辑模式不传，用内部状态 */
  type?: FormKind;
  /** 本子里已有的照片/视频（手账页「从本子里选」用） */
  album?: AlbumPickItem[];
  /** 本子里已用过的标签（输入框下的「标签库」建议） */
  knownTags?: string[];
  /** 从标签库里全局删掉一个标签 */
  onTagDelete?: (name: string) => void;
  onSaved: (entry: EntryDTO, isNew: boolean) => void;
  onCancel?: () => void;
  /** 向外同步当前选的类型（写一页/拼一页 的切换入口只在「手账页」下出现） */
  onTypeChange?: (t: FormKind) => void;
}) {
  const toast = useToast();
  const [innerType, setInnerType] = useState<FormKind>(initial?.type ?? "journal");
  const type = typeProp ?? innerType;
  const selectType = (t: FormKind) => {
    setInnerType(t);
    onTypeChange?.(t);
  };
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [speaker, setSpeaker] = useState(initial?.speaker ?? "她说");
  const [mood, setMood] = useState<StickerName | "">(initial?.mood && STICKER_NAMES.includes(initial.mood as StickerName) ? (initial.mood as StickerName) : "");
  const [date, setDate] = useState(initial?.entry_date ?? todayStr());
  const [revealAt, setRevealAt] = useState(initial?.reveal_at ?? "");
  // 访客模式：这一页只给她看，还是连访客也能看（默认仅她）
  const [isPublic, setIsPublic] = useState(initial?.visibility === "public");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [items, setItems] = useState<PickItem[]>(() => {
    // 语音由 VoiceRecorder 单独管，不混进照片卡；引用来的媒体带上 fromRef
    const initialItems: PickItem[] = (initial?.media ?? [])
      .filter((m) => m.kind !== "audio")
      .map((m) => ({
        key: localKey(),
        existing: m,
        fromRef: m.ref === true,
        previewUrl: m.thumbUrl ?? m.url,
        caption: m.caption ?? "",
        kind: m.kind === "video" ? ("video" as const) : ("photo" as const),
      }));
    // 重建 Live 配对：编辑时配对视频也并进照片卡，不再单独占一张
    for (const p of initialItems) {
      if (!p.existing?.liveVideo) continue;
      const vid = p.existing.liveVideo.replace("/api/media/", "");
      const v = initialItems.find((x) => x.existing?.id === vid);
      if (v && !v.pairedTo) {
        p.pairVideoKey = v.key;
        v.pairedTo = p.key;
      }
    }
    return initialItems;
  });
  const removedRef = useRef<Set<string>>(new Set());
  // 语录的语音草稿：编辑已有语录时回填它存着的音频
  const [voice, setVoice] = useState<VoiceDraft | null>(() => {
    const a = initial?.media.find((m) => m.kind === "audio");
    return a ? { key: `voice-${a.id}`, existing: a, url: a.url, duration: a.duration ?? null } : null;
  });
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const [error, setError] = useState("");
  const [pairHint, setPairHint] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  // 拖拽上传：文件 / 文件夹拖进媒体区高亮，松手就走和「选文件夹」同一条管线
  const [dragOn, setDragOn] = useState(false);
  const [dateHint, setDateHint] = useState("");
  const [dateSuggest, setDateSuggest] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // 后台上传：状态放 ref（进度变化 bump 一下就够），提交时从里面拿 dto
  const upRef = useRef(new Map<string, UpState>());
  // 「整批取消」的代数：+1 后所有老任务作废，新任务用新代数照常传
  const uploadGenRef = useRef(0);
  // 大批量（文件夹）上传两阶段：先「分析」（指纹+查重+进度条，不渲染缩略图不卡浏览器），
  // 确认后只把新增部分放进预览并开传；已传过/疑似重复的收进单独标签页随时能看
  const [analysis, setAnalysis] = useState<
    | { status: "analyzing"; total: number; scanned: number }
    | { status: "ready"; total: number; freshN: number; dupN: number; suspectN: number; oversizeN: number }
    | null
  >(null);
  const pendingBatchRef = useRef<PickItem[] | null>(null);
  const pendingOversizeRef = useRef<{ key: string; name: string }[]>([]);
  const pendingTakenDatesRef = useRef<string[] | null>(null);
  const analysisAbortRef = useRef(false);
  /** 预览区标签：默认只看要上传的；已传过/重复的收在另一个标签里 */
  const [previewFilter, setPreviewFilter] = useState<"new" | "dup">("new");
  const [renderLimit, setRenderLimit] = useState(RENDER_CHUNK);
  const moreRef = useRef<HTMLDivElement>(null);
  // 已传好但还没贴进本子的文件：移除卡片 / 离开表单时清掉，免得变成墙上的幽灵照片
  const dtoRef = useRef(new Map<string, MediaDTO>());
  const itemsRef = useRef<PickItem[]>([]);
  itemsRef.current = items;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  // 用户手动改过日期后，不再自动覆盖（编辑已有条目时也不动）
  const dateTouched = useRef(Boolean(initial));
  const dateHintTimer = useRef<number | null>(null);

  function showDateHint(text: string, suggest: string | null = null, ms = 6000) {
    if (dateHintTimer.current !== null) clearTimeout(dateHintTimer.current);
    setDateHint(text);
    setDateSuggest(suggest);
    dateHintTimer.current = window.setTimeout(() => {
      setDateHint("");
      setDateSuggest(null);
    }, ms);
  }

  useEffect(() => {
    onTypeChange?.(type);
  }, [type, onTypeChange]);

  const busy = phase !== "idle";
  const isQuote = type === "quote";
  const isPhoto = type === "photo";
  const isLetter = type === "letter";

  /** 换语音草稿：旧的是已入库的记进待删名单，是本地预览的就释放掉 */
  function changeVoice(v: VoiceDraft | null) {
    if (voice?.existing && v?.existing !== voice.existing) removedRef.current.add(voice.existing.id);
    if (voice && !voice.existing) URL.revokeObjectURL(voice.url);
    setVoice(v);
  }

  /** 离开表单时清掉「传好了但从没贴进本子」的文件，别留在墙上当幽灵 */
  useEffect(() => {
    const dtos = dtoRef.current;
    const ups = upRef.current;
    return () => {
      for (const dto of dtos.values()) void discardDto(dto);
      for (const st of ups.values()) st.controller.abort();
    };
  }, []);

  function patchItem(key: string, patch: Partial<PickItem>) {
    setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  async function discardDto(dto: MediaDTO) {
    // keepalive：关页面/切走的瞬间也能把请求发完，不然会留下墙上多出来的「幽灵照片」
    await fetch(`/api/media/${dto.id}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
  }

  /** 重传也没戏的失败（超大小上限）：不发请求，直接亮错误，不给重传按钮 */
  function failFatal(key: string, msg: string) {
    const st = {
      status: "error",
      pct: 0,
      error: msg,
      fatal: true,
      controller: new AbortController(),
      promise: Promise.reject(new Error(msg)),
    } as UpState;
    st.promise.catch(() => undefined);
    upRef.current.set(key, st);
    bump();
  }

  /** 后台上传一个文件：并发闸门排队，进度和结果都记在 upRef。
   *  gen 是「整批取消」的代数：取消后老任务排到闸门也不会再传，新任务用新代数照常工作 */
  function enqueueUpload(key: string, file: File, meta: { width?: number; height?: number; hevc?: boolean | null; fp?: string }) {
    if (upRef.current.has(key)) return;
    const controller = new AbortController();
    const gen = uploadGenRef.current;
    const st = { status: "waiting", pct: 0, controller } as UpState;
    st.promise = (async () => {
      await uploadSem.acquire();
      if (upRef.current.get(key) !== st || uploadGenRef.current !== gen) {
        uploadSem.release();
        throw new Error("已取消");
      }
      st.status = "uploading";
      bump();
      try {
        const dto = await uploadFile(file, {
          width: meta.width,
          height: meta.height,
          hevc: meta.hevc ?? null,
          signal: controller.signal,
          fingerprint: meta.fp,
          onProgress: (loaded) => {
            if (file.size <= 0) return;
            const pct = Math.min(99, Math.round((loaded / file.size) * 100));
            if (pct > st.pct) {
              st.pct = pct;
              bump();
            }
          },
        });
        st.status = "done";
        st.pct = 100;
        st.dto = dto;
        dtoRef.current.set(key, dto);
        bump();
        return dto;
      } catch (e) {
        st.status = controller.signal.aborted || uploadGenRef.current !== gen ? "cancelled" : "error";
        st.error = e instanceof Error ? e.message : "上传失败";
        bump();
        if (st.status === "error") toast(`${st.error}（可点卡片上的「重传」）`, "error");
        throw e;
      } finally {
        uploadSem.release();
      }
    })();
    // 拒绝都在状态里体现了，这里吞掉避免未处理告警
    st.promise.catch(() => undefined);
    upRef.current.set(key, st);
    bump();
  }

  /** 整批取消（原子）：在传的立刻掐断、排队的作废、刚传好的从服务器撤下——回到没选文件之前 */
  function cancelAllUploads() {
    uploadGenRef.current += 1;
    let wiped = 0;
    for (const st of upRef.current.values()) {
      if (st.status === "waiting" || st.status === "uploading") st.controller.abort();
      if (st.status === "done" && st.dto) {
        void discardDto(st.dto);
        wiped += 1;
      }
    }
    // 传好的全部撤下：媒体从 dtoRef 里清掉（卸载清理就不会再删一遍），状态标成 cancelled 可单个重传
    for (const [key, st] of upRef.current) {
      if (st.status === "done" && st.dto) {
        dtoRef.current.delete(key);
        st.status = "cancelled";
        st.pct = 0;
        st.dto = undefined;
      }
    }
    toast(wiped > 0 ? `已取消整批上传，刚传好的 ${wiped} 个也从服务器撤下了` : "已取消整批上传");
    bump();
  }

  function retryUpload(key: string) {
    const it = itemsRef.current.find((x) => x.key === key);
    if (!it?.file) return;
    upRef.current.delete(key);
    enqueueUpload(key, it.file, { width: it.width, height: it.height, hevc: it.hevc, fp: it.fp });
  }

  /** 「疑似重复」的卡片改主意了：去掉标记，补上上传 */
  function restoreSuspect(key: string) {
    const it = itemsRef.current.find((x) => x.key === key);
    if (!it?.file) return;
    patchItem(key, { dupSuspect: false });
    enqueueUpload(key, it.file, { width: it.width, height: it.height, hevc: it.hevc, fp: it.fp });
  }

  /** Live 配对卡的聚合上传状态：照片+视频取最差状态、进度取平均（UploadChip 只读 status/pct/error/fatal） */
  function unitUpState(item: PickItem): UpState | undefined {
    const st = upRef.current.get(item.key);
    if (!item.pairVideoKey) return st;
    const vst = upRef.current.get(item.pairVideoKey);
    if (!st && !vst) return undefined;
    const parts = [st, vst].filter(Boolean) as UpState[];
    const pct = Math.round(parts.reduce((s, p) => s + p.pct, 0) / parts.length);
    const pick = (p: UpState | undefined, status?: UpState["status"]) => ({ ...(p ?? st!), pct, ...(status ? { status } : {}) }) as UpState;
    const err = parts.find((p) => p.status === "error");
    if (err) return pick(err);
    if (parts.some((p) => p.status === "uploading")) return pick(undefined, "uploading");
    const cancelled = parts.find((p) => p.status === "cancelled");
    if (cancelled) return pick(cancelled);
    if (parts.every((p) => p.status === "done")) return pick(undefined, "done");
    return pick(undefined, "waiting");
  }

  /** 成对重传：Live 卡的照片和配对视频一起重来 */
  function retryUnit(item: PickItem) {
    retryUpload(item.key);
    if (item.pairVideoKey) retryUpload(item.pairVideoKey);
  }

  /** 元信息探测 + 三层查重，结果直接写进 item（大批量分析阶段和选完即传的小批量共用）。
   *  探测：宽高 / 压缩 / 拍摄日期 / 内容指纹；查重：库里已传（指纹查服务器）→ 批内重复（指纹互比）
   *  → 名字疑似（去掉「(1)」后缀比名字，抓重编码过的副本）。返回拍摄日期列表给表单日期用 */
  async function analyzeBatchItems(
    batch: PickItem[],
    opts: { onProgress?: () => void; shouldAbort?: () => boolean } = {}
  ): Promise<string[]> {
    const takenDates: string[] = [];
    await Promise.all(
      batch.map(async (item) => {
        await metaSem.acquire();
        try {
          if (opts.shouldAbort?.()) return;
          const f = item.file!;
          if (item.kind === "video") {
            // 宽高和编码先探好：宽高入库定卡片比例，HEVC 标记用来提示「电脑可能放不了」
            const [size, hevc, taken, fp] = await Promise.all([probeVideoSize(f), sniffHevc(f), readTakenAt(f), fileFingerprint(f)]);
            if (taken) takenDates.push(taken);
            item.width = size.width;
            item.height = size.height;
            item.hevc = hevc;
            item.takenAt = taken ?? undefined;
            item.fp = fp;
          } else {
            const [shrunk, taken] = await Promise.all([shrinkImage(f), readTakenAt(f)]);
            // 指纹按「实际要上传的那份」算（压缩后的），和库里存的能对上
            const fp = await fileFingerprint(shrunk.file);
            if (taken) takenDates.push(taken);
            item.file = shrunk.file;
            item.width = shrunk.width;
            item.height = shrunk.height;
            item.takenAt = taken ?? undefined;
            item.fp = fp;
          }
        } finally {
          metaSem.release();
        }
        opts.onProgress?.();
      })
    );
    if (opts.shouldAbort?.()) return takenDates;

    // 库内查重 + 批内指纹互查（Live 配对视作一体）
    const seenFp = new Map<string, PickItem>();
    for (const it of batch) {
      if (it.dup || !it.fp) continue;
      const first = seenFp.get(it.fp);
      if (first) {
        // 批内重复：库里还没有对应媒体（第一份也才刚要传），标上第一份的名字
        it.dup = { id: "", kind: it.kind, thumbUrl: null, entryDate: null, caption: null };
        it.dupBatchName = first.file?.name ?? "";
      } else {
        seenFp.set(it.fp, it);
      }
    }
    const found = await lookupFingerprints([...seenFp.keys()]);
    for (const it of batch) {
      if (it.dup || !it.fp) continue;
      const hit = found[it.fp];
      if (hit) it.dup = hit;
    }
    // 一头是重复的 Live 配对，整对跳过（livp 拆开的照片+视频本来就是一体）
    for (const it of batch) {
      if (!it.dup) continue;
      const partner = it.pairVideoKey ?? it.pairedTo;
      const p = partner ? batch.find((x) => x.key === partner) : undefined;
      if (p && !p.dup) {
        p.dup = it.dup.id ? it.dup : { id: "", kind: p.kind, thumbUrl: null, entryDate: null, caption: null };
        if (!it.dup.id) p.dupBatchName = it.file?.name ?? "";
      }
    }

    // 名字层面的「疑似重复」：同一张导出/下载两遍会得到「xxx (1).jpg」这种名字，
    // 但字节往往被重编码过（指纹全对不上——上面两层查重抓不到它们），只能靠名字认
    const normBase = (n: string) =>
      baseName(n)
        .replace(/[\s_-]*[(（]\d+[)）]\s*$/i, "")
        .trim();
    const firstByName = new Map<string, string>();
    for (const it of batch) {
      // 已配对的 Live 视频和它的照片同名是「IMG_xxx.HEIC + IMG_xxx.MOV」导出机制决定的，不是重复
      if (!it.file || it.dup || it.pairedTo) continue;
      const nm = normBase(it.file.name);
      if (!nm) continue;
      const first = firstByName.get(nm);
      if (first) it.dupSuspect = true;
      else firstByName.set(nm, nm);
    }
    return takenDates;
  }

  async function addFiles(list: FileList | File[] | null) {
    if (!list || list.length === 0) return;
    // 有一批还在分析或等着确认：先处理完它再选新的，两批混在一起理不清
    if (analysis) {
      toast("先把这批处理完（开始上传或取消）再选新的");
      if (fileInput.current) fileInput.current.value = "";
      if (folderInput.current) folderInput.current.value = "";
      return;
    }
    // livp（iPhone 导出的 Live 图，本质是 zip：照片+视频）先拆开——
    // 拆出的两个文件用 livp 文件名做同名基底，正好走下面的「同名自动配对」
    let files = Array.from(list).filter((f) => !f.name.startsWith("."));
    const livps = files.filter((f) => /\.livp$/i.test(f.name));
    if (livps.length > 0) {
      files = files.filter((f) => !/\.livp$/i.test(f.name));
      setPairHint(`正在拆开 ${livps.length} 个 Live 图（.livp）…`);
      const expanded: File[] = [];
      await Promise.all(
        livps.map(async (f) => {
          await metaSem.acquire();
          try {
            expanded.push(...(await expandLivp(f)));
          } catch {
            /* 拆不开的跳过 */
          } finally {
            metaSem.release();
          }
        })
      );
      files = [...files, ...expanded];
      setPairHint(expanded.length > 0 ? `已拆开 ${livps.length} 个 Live 图，同名的照片+视频会自动配对` : "这些 livp 里没找到照片/视频，跳过了");
      setTimeout(() => setPairHint(""), 6000);
    }
    const next: PickItem[] = [];
    const oversize: { key: string; name: string }[] = [];
    for (const f of files) {
      // 文件夹导入时有些类型是空的，按扩展名兜底判断照片/视频
      const isVideo = f.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(f.name);
      const isImage = f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|avif|svg)$/i.test(f.name);
      if (!isVideo && !isImage) continue;
      const key = localKey();
      if (f.size > MAX_UPLOAD_BYTES) oversize.push({ key, name: f.name });
      next.push({
        key,
        file: f,
        previewUrl: URL.createObjectURL(f),
        caption: "",
        kind: isVideo ? "video" : "photo",
      });
    }
    if (next.length === 0) return;
    const paired = autoPair(next);
    if (paired > 0) {
      setPairHint(`检测到 ${paired} 组同名照片+视频，已自动配对成 Live Photo`);
      setTimeout(() => setPairHint(""), 5000);
    }
    if (fileInput.current) fileInput.current.value = "";
    if (folderInput.current) folderInput.current.value = "";

    // 大批量（整个文件夹）：先「分析」再「确认」。几百个缩略图一口气渲染会把浏览器卡死，
    // 所以先只给进度条（指纹 + 三层查重），用户确认后才把新增部分放进预览并开传
    if (next.length > 20) {
      analysisAbortRef.current = false;
      pendingBatchRef.current = next;
      pendingOversizeRef.current = oversize;
      setAnalysis({ status: "analyzing", total: next.length, scanned: 0 });
      const takenDates = await analyzeBatchItems(next, {
        onProgress: () => setAnalysis((a) => (a && a.status === "analyzing" ? { ...a, scanned: a.scanned + 1 } : a)),
        shouldAbort: () => analysisAbortRef.current,
      });
      if (analysisAbortRef.current) return; // 用户点了取消
      pendingTakenDatesRef.current = takenDates;
      const oversizeKeys = new Set(oversize.map((o) => o.key));
      // 汇总按「项」算：Live Photo 的照片+视频合成一张卡，算一项（和相册里看到的一致）
      const units = next.filter((x) => !x.pairedTo);
      setAnalysis({
        status: "ready",
        total: units.length,
        freshN: units.filter(
          (x) => !x.dup && !x.dupSuspect && !oversizeKeys.has(x.key) && !(x.pairVideoKey && oversizeKeys.has(x.pairVideoKey))
        ).length,
        dupN: units.filter((x) => x.dup).length,
        suspectN: units.filter((x) => x.dupSuspect).length,
        oversizeN: oversize.length,
      });
      return;
    }

    // 小批量：维持原行为，选完就出卡、后台传，写描述不用等
    setItems((prev) => [...prev, ...next]);
    // 超过大小上限的直接亮「传不了」，不发请求也不给重传（传了也白传）
    for (const { key, name } of oversize) failFatal(key, `「${name}」太大了（单文件最多 ${MAX_UPLOAD_LABEL}）`);
    const takenDates = await analyzeBatchItems(next);
    // 分析结果写回 React state：state 里的 item 可能已被「预览失败」等 patchItem 换成副本，
    // 分析直接改的是数组里的原对象，必须补一遍 patch 才能同步到正在显示的副本上
    for (const it of next) {
      patchItem(it.key, {
        file: it.file,
        width: it.width,
        height: it.height,
        hevc: it.hevc,
        takenAt: it.takenAt,
        fp: it.fp,
        ...(it.dup ? { dup: it.dup, dupBatchName: it.dupBatchName } : {}),
        ...(it.dupSuspect ? { dupSuspect: true } : {}),
      });
    }
    const oversizeKeys = new Set(oversize.map((o) => o.key));
    const dupN = next.filter((x) => x.dup).length;
    const suspectN = next.filter((x) => x.dupSuspect).length;
    if (dupN > 0) toast(`跳过 ${dupN} 个已传过/重复的文件（灰色卡片不会重复上传）`);
    if (suspectN > 0) toast(`有 ${suspectN} 个文件名字像重复的（内容其实不同），已灰掉标记，想留下点「仍然要传」`);
    for (const it of next) {
      if (it.dup || it.dupSuspect || oversizeKeys.has(it.key)) continue;
      if (it.file) enqueueUpload(it.key, it.file, { width: it.width, height: it.height, hevc: it.hevc, fp: it.fp });
    }
    applyTakenDates(takenDates);
  }

  /** 确认开始上传：把分析好的这批放进预览（重复的收进「已传过」标签），新增的开传 */
  function confirmUpload() {
    const next = pendingBatchRef.current;
    if (!next) return;
    pendingBatchRef.current = null;
    const oversize = pendingOversizeRef.current;
    pendingOversizeRef.current = [];
    setItems((prev) => [...prev, ...next]);
    setPreviewFilter("new");
    setRenderLimit(RENDER_CHUNK);
    for (const { key, name } of oversize) failFatal(key, `「${name}」太大了（单文件最多 ${MAX_UPLOAD_LABEL}）`);
    const oversizeKeys = new Set(oversize.map((o) => o.key));
    let started = 0;
    for (const it of next) {
      if (it.dup || it.dupSuspect || oversizeKeys.has(it.key)) continue;
      if (it.file) {
        enqueueUpload(it.key, it.file, { width: it.width, height: it.height, hevc: it.hevc, fp: it.fp });
        started++;
      }
    }
    applyTakenDates(pendingTakenDatesRef.current ?? []);
    pendingTakenDatesRef.current = null;
    setAnalysis(null);
    if (started > 0) toast(`开始上传 ${started} 个新文件（Live Photo 的照片+视频算一项）`);
  }

  /** 放弃这批：停掉分析（或丢掉待确认结果），什么都不传 */
  function abortAnalysis() {
    analysisAbortRef.current = true;
    const next = pendingBatchRef.current;
    pendingBatchRef.current = null;
    pendingTakenDatesRef.current = null;
    pendingOversizeRef.current = [];
    if (next) for (const it of next) URL.revokeObjectURL(it.previewUrl);
    setAnalysis(null);
  }

  /** 拍摄时间与所选日期的处理：没手改过就自动设；手改过则保留并提示差异。
   *  「存照片」模式下每个文件会按自己的拍摄日期分页，这里只影响没有拍摄时间的文件 */
  function applyTakenDates(takenDates: string[]) {
    if (takenDates.length === 0) return;
    if (!isPhoto) {
      const sorted = [...takenDates].sort();
      const latest = sorted.at(-1)!;
      const earliest = sorted[0];
      const days = new Set(takenDates).size;
      const span = days > 1 ? `${earliest.replaceAll("-", ".")} ~ ${latest.replaceAll("-", ".")}` : latest.replaceAll("-", ".");
      if (!dateTouched.current) {
        setDate(latest);
        showDateHint(
          days > 1 ? `这批文件跨了 ${days} 天（${span}），日期取了最近的一天，可手动改` : `日期已按拍摄时间设为 ${span}`
        );
      } else if (latest !== date) {
        showDateHint(`已保留你选的 ${date.replaceAll("-", ".")}，这批文件拍摄于 ${span}`, latest);
      }
    } else if (!dateTouched.current) {
      // 存照片：日期输入框作为「没有拍摄时间的文件」的兜底日期，静默取最近一天
      setDate([...takenDates].sort().at(-1)!);
    }
  }

  /** 从本子里选：把已有的照片/视频引用进这一页（不动相册里的原文件） */
  function addFromAlbum(p: AlbumPickItem) {
    setItems((prev) => [
      ...prev,
      {
        key: localKey(),
        existing: {
          id: p.id,
          url: p.url,
          thumbUrl: p.thumbUrl ?? null,
          posterUrl: p.posterUrl ?? null,
          kind: p.kind,
          mime: p.mime ?? "",
          width: p.width ?? null,
          height: p.height ?? null,
          caption: p.caption,
          liveVideo: p.liveVideo ?? null,
          hevc: p.hevc ?? null,
          duration: null,
          ref: true,
        },
        fromRef: true,
        previewUrl: p.thumbUrl ?? p.url,
        caption: "",
        kind: p.kind,
      },
    ]);
  }

  function markPreviewBroken(key: string) {
    setItems((prev) => prev.map((x) => (x.key === key && !x.previewBroken ? { ...x, previewBroken: true } : x)));
  }

  /** 合并成 Live 的卡：照片解不开时，用配对视频当预览（能看到画面还能播） */
  function livePreviewSrcOf(item: PickItem): string | null {
    const pair = item.pairVideoKey ? items.find((x) => x.key === item.pairVideoKey) : null;
    return pair?.previewUrl ?? item.existing?.liveVideo ?? null;
  }

  function removeItem(item: PickItem) {
    if (item.existing) removedRef.current.add(item.existing.id);
    if (!item.existing) URL.revokeObjectURL(item.previewUrl);
    // 后台上传中的作废；已经传好的直接从库里删掉，别留成墙上的幽灵照片
    const st = upRef.current.get(item.key);
    if (st) {
      st.controller.abort();
      upRef.current.delete(item.key);
      if (st.dto) {
        dtoRef.current.delete(item.key);
        // 可能已经贴进本子了（保存过又移除）：记进待删名单，下次保存时由条目接口删
        removedRef.current.add(st.dto.id);
        void discardDto(st.dto);
      }
    }
    setItems((prev) =>
      prev
        .filter((x) => x.key !== item.key)
        .map((x) => (x.pairVideoKey === item.key ? { ...x, pairVideoKey: undefined } : x))
        .map((x) => (x.pairedTo === item.key ? { ...x, pairedTo: undefined } : x))
    );
  }

  function setCaption(key: string, caption: string) {
    setItems((prev) => prev.map((x) => (x.key === key ? { ...x, caption } : x)));
  }

  /** 手动配对：把某个视频配到某张照片（点视频卡片上的链接按钮 = 配到它前面最近一张未配对的照片） */
  function pairToNearest(videoKey: string) {
    setItems((prev) => {
      const video = prev.find((x) => x.key === videoKey);
      if (!video || video.pairedTo) return prev;
      const target = [...prev]
        .reverse()
        .find((x) => x.kind === "photo" && !x.existing && !x.pairVideoKey && x.key !== videoKey);
      if (!target) {
        setPairHint("前面没有可配对的新照片了");
        setTimeout(() => setPairHint(""), 3000);
        return prev;
      }
      setPairHint(`已配对：${target.file?.name ?? "照片"} + ${video.file?.name ?? "视频"}`);
      setTimeout(() => setPairHint(""), 4000);
      return prev.map((x) => (x.key === target.key ? { ...x, pairVideoKey: videoKey } : x.key === videoKey ? { ...x, pairedTo: target.key } : x));
    });
  }

  function unpair(photoKey: string) {
    setItems((prev) =>
      prev.map((x) => {
        if (x.key === photoKey) return { ...x, pairVideoKey: undefined };
        if (x.pairedTo === photoKey) return { ...x, pairedTo: undefined };
        return x;
      })
    );
  }

  // 已配对成 Live Photo 的视频不单独展示——它属于照片卡的一部分；已传过的（重复）不算数
  const visibleItems = items.filter((x) => !x.pairedTo);
  // 预览区两个标签：要上传的 / 已传过·重复的（默认前者，重复的不刷屏但随时能翻出来看）
  const dupPreviewItems = visibleItems.filter((x) => x.dup || x.dupSuspect);
  const newPreviewItems = visibleItems.filter((x) => !x.dup && !x.dupSuspect);
  const filterBase = previewFilter === "new" ? newPreviewItems : dupPreviewItems;
  const shownItems = filterBase.slice(0, renderLimit);

  // 滚到预览底部自动多渲染一批（懒加载：只解码进视口附近的缩略图）
  useEffect(() => {
    const el = moreRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setRenderLimit((n) => n + RENDER_CHUNK);
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [previewFilter, renderLimit, items.length]);
  const liveItems = items.filter((x) => !x.dup && !x.dupSuspect);
  // 后台上传总览（选完即传，写描述不用干等）。
  // 计数按「项」算：Live Photo 的照片+视频是一张卡，算一项——
  // 状态取两者里最差的（有一个失败就算失败），进度取平均，这样和看到的卡片数对得上
  const uploadUnits = items.filter((x) => x.file && !x.dup && !x.dupSuspect && !x.pairedTo);
  const upStats = { waiting: 0, uploading: 0, done: 0, error: 0 };
  let pctSum = 0;
  for (const x of uploadUnits) {
    const parts = [upRef.current.get(x.key), x.pairVideoKey ? upRef.current.get(x.pairVideoKey) : undefined].filter(
      Boolean
    ) as UpState[];
    pctSum += parts.length ? parts.reduce((s, p) => s + p.pct, 0) / parts.length : 0;
    if (parts.some((p) => p.status === "error")) upStats.error += 1;
    else if (parts.length === 0 || parts.some((p) => p.status === "waiting")) upStats.waiting += 1;
    else if (parts.some((p) => p.status === "uploading")) upStats.uploading += 1;
    else if (parts.every((p) => p.status === "done")) upStats.done += 1;
  }
  const upPct = uploadUnits.length > 0 ? Math.round(pctSum / uploadUnits.length) : 0;
  const canSubmit = useMemo(() => {
    if (isQuote) return body.trim().length > 0 || voice !== null;
    if (isLetter) return body.trim().length > 0;
    if (isPhoto) return liveItems.length > 0;
    return body.trim().length > 0 || liveItems.length > 0;
  }, [isQuote, isLetter, isPhoto, body, liveItems.length, voice]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (type === "milestone" || type === "egg") return; // 这两个类型的外部表单不走这里的提交
    if (busy || !canSubmit) return;
    setError("");
    try {
      // 选完就开始后台传了，这里通常只剩尾巴；有失败的先处理掉（超限的移除、别的重传）
      const fileKeys = items.filter((x) => x.file && !x.dup && !x.dupSuspect).map((x) => x.key);
      const failed = fileKeys.filter((k) => upRef.current.get(k)?.status === "error");
      const cancelledN = fileKeys.filter((k) => upRef.current.get(k)?.status === "cancelled").length;
      if (cancelledN > 0) {
        throw new Error(`有 ${cancelledN} 个文件的上传被取消了：点卡片上的「重传」，或把它们移除后再保存`);
      }
      if (failed.length > 0) {
        const fatalN = failed.filter((k) => upRef.current.get(k)?.fatal).length;
        throw new Error(
          fatalN === failed.length
            ? `有 ${failed.length} 个文件超过 ${MAX_UPLOAD_LABEL} 上限传不了，把它们移除后再保存（或拆成小段再传）`
            : `还有 ${failed.length} 个文件没传上去，在卡片上点「重传」`
        );
      }
      if (fileKeys.length > 0) {
        setPhase("uploading");
        await Promise.all(fileKeys.map((k) => upRef.current.get(k)!.promise));
      }
      const voiceFile = voice?.file ?? null;
      let voiceMedia: MediaDTO | null = null;
      if (voiceFile) {
        setPhase("uploading");
        voiceMedia = await uploadFile(voiceFile, { duration: voice!.duration });
      }
      setPhase("saving");
      // 每个展示单元一张卡（Live 配对的视频跟着照片走）
      // caption 原样传（空串 = 清空描述），服务端 NULLIF 处理
      type Card = { mediaId: string; caption: string; videoMediaId: string | null; date: string; ref: boolean };
      const dtoOf = (key: string): MediaDTO | undefined => upRef.current.get(key)?.dto;
      const dateOf = (x: PickItem): string => {
        if (x.pairedTo) {
          const photo = items.find((p) => p.key === x.pairedTo);
          if (photo) return dateOf(photo);
        }
        // 卡片上手动改过的日期最优先，其次拍摄日期，都没有用页面选的日期兜底
        return x.userDate ?? x.takenAt ?? date;
      };
      const cards: Card[] = [];
      for (const x of items) {
        if (x.dup || x.dupSuspect) continue; // 已传过/疑似重复的跳过，不再重复入册
        if (x.existing) {
          cards.push({
            mediaId: x.existing.id,
            caption: x.caption,
            videoMediaId: x.existing.liveVideo ? x.existing.liveVideo.replace("/api/media/", "") : null,
            date: dateOf(x),
            ref: x.fromRef === true,
          });
        } else if (x.pairVideoKey) {
          const video = dtoOf(x.pairVideoKey);
          cards.push({ mediaId: dtoOf(x.key)!.id, caption: x.caption, videoMediaId: video?.id ?? null, date: dateOf(x), ref: false });
        } else if (!x.pairedTo) {
          cards.push({ mediaId: dtoOf(x.key)!.id, caption: x.caption, videoMediaId: null, date: dateOf(x), ref: false });
        }
      }
      // owned 媒体挂 entry_id；引用的媒体（从本子里选）只写 ref_media，可写自己的描述
      const splitCards = (list: Card[]) => {
        const media: { id: string; caption: string; sort: number; liveVideoId: string | null }[] = [];
        const refs: { id: string; caption: string; sort: number }[] = [];
        let sort = 0;
        for (const c of list) {
          if (c.ref) {
            refs.push({ id: c.mediaId, caption: c.caption, sort: sort++ });
            continue;
          }
          media.push({ id: c.mediaId, caption: c.caption, sort: sort++, liveVideoId: c.videoMediaId });
          // 配对的视频也挂到条目上（不单独展示），删除条目时才能一并清掉
          if (c.videoMediaId) media.push({ id: c.videoMediaId, caption: "", sort: 900 + sort, liveVideoId: null });
        }
        return { media, refs };
      };
      const base = {
        type,
        title: type === "journal" || type === "letter" ? title : undefined,
        body,
        speaker: isQuote ? speaker : undefined,
        mood: mood || undefined,
        revealAt: isLetter ? revealAt || undefined : undefined,
        removeMediaIds: [...removedRef.current],
        tags: type === "journal" || isPhoto ? tags : undefined,
        visibility: isPublic ? ("public" as const) : ("private" as const),
      };

      // 「存照片」新建：按各自拍摄日期自动拆成多页，分别出现在对应日期里
      if (!initial && isPhoto) {
        const groups = new Map<string, Card[]>();
        for (const c of cards) groups.set(c.date, [...(groups.get(c.date) ?? []), c]);
        const sorted = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
        let last: EntryDTO | null = null;
        for (const [d, list] of sorted) {
          const { media } = splitCards(list);
          const res = await fetch("/api/entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...base, entryDate: d, media }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "保存失败了");
          last = data.entry as EntryDTO;
        }
        toast(`已按日期分成 ${sorted.length} 页贴好`);
        reset();
        onSaved(last!, true);
        return;
      }

      // 语录的语音挂到条目上：新录的用刚上传的 media id，没动过就用原有的
      const { media, refs } = splitCards(cards);
      if (voiceMedia) media.push({ id: voiceMedia.id, caption: "", sort: 500, liveVideoId: null });
      else if (voice?.existing) media.push({ id: voice.existing.id, caption: "", sort: 500, liveVideoId: null });

      const payload = { ...base, entryDate: date, media, refMedia: refs.length > 0 ? refs : undefined };
      const res = await fetch(initial ? `/api/entries/${initial.id}` : "/api/entries", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "保存失败了");
      // 这次真正入册的文件从「待清理」名单里摘掉：编辑已有条目保存后表单会被关掉，
      // 名单不清空的话，卸载清理会把刚贴进本子的照片当孤儿从服务器上撤下
      const savedIds = new Set(media.map((m) => m.id));
      for (const [k, dto] of dtoRef.current) if (savedIds.has(dto.id)) dtoRef.current.delete(k);
      const isNew = !initial;
      if (isNew) reset();
      onSaved(data.entry, isNew);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存失败了";
      setError(msg);
      toast(msg, "error");
      setPhase("idle");
    }
  }

  function reset() {
    setInnerType(typeProp ?? "journal");
    setTitle("");
    setBody("");
    setSpeaker("她说");
    setMood("");
    setDate(todayStr());
    setRevealAt("");
    setIsPublic(false);
    setTags([]);
    for (const x of items) if (!x.existing) URL.revokeObjectURL(x.previewUrl);
    setItems([]);
    if (voice && !voice.existing) URL.revokeObjectURL(voice.url);
    setVoice(null);
    removedRef.current = new Set();
    // 都贴进本子了：清掉「待清理」名单，卸载时才不会误删
    upRef.current.clear();
    dtoRef.current.clear();
    setShowPicker(false);
    setPhase("idle");
    setError("");
  }

  // 类型选择卡：手账/照片/语录/信用本表单；大事记/彩蛋选中后由外层换上对应表单
  const typeCards = (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {TYPES.map(({ value, label, icon: Icon, hint }) => (
        <button
          key={value}
          type="button"
          disabled={busy}
          onClick={() => selectType(value)}
          className={cn(
            "flex flex-col items-center gap-1 rounded-2xl border-2 px-2 py-3.5 transition-all duration-300 ease-spring",
            type === value
              ? "-translate-y-0.5 border-rose bg-rose-soft/60 shadow-sm"
              : "border-ink/10 hover:border-ink/25 hover:bg-ink/[0.03]"
          )}
        >
          <Icon weight={type === value ? "fill" : "regular"} className={cn("size-6", type === value ? "text-rose-deep" : "text-ink-soft")} />
          <span className="text-sm font-bold">{label}</span>
          <span className="text-xs text-ink-soft/80">{hint}</span>
        </button>
      ))}
    </div>
  );

  // 大事记 / 彩蛋：只留类型卡，表单由外层（写一页工作台）渲染
  if (type === "milestone" || type === "egg") {
    return (
      <div className="card-paper">
        {typeCards}
        <p className="mt-4 px-1 text-xs leading-relaxed text-ink-soft/80">
          {type === "milestone"
            ? "时间轴只放你挑出来的时刻：哪天第一次见面、第一次旅行……手动录入，配上照片和视频，做成里程碑。"
            : "每个彩蛋有自己的揭晓日期、密码、精选照片和一封信；到日子她凭密码打开，还能在照片上画画留言。"}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card-paper">
      {typeCards}

      {/* 日期 + 标题 */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-3.5 py-2">
          <CalendarBlank className="size-4 text-ink-soft" />
          <input
            type="date"
            value={date}
            onChange={(e) => {
              dateTouched.current = true;
              setDate(e.target.value);
            }}
            disabled={busy}
            aria-label="日期"
            className="bg-transparent font-round text-sm tracking-wider outline-none"
          />
        </label>
        {isLetter ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="这封信的称呼（可不填）"
            disabled={busy}
            className="min-w-40 flex-1 rounded-full border border-ink/15 bg-paper px-4 py-2 text-sm outline-none placeholder:text-ink-soft/50 focus:border-rose"
          />
        ) : type === "journal" ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="给这一页起个标题（可不填）"
            disabled={busy}
            className="min-w-40 flex-1 rounded-full border border-ink/15 bg-paper px-4 py-2 text-sm outline-none placeholder:text-ink-soft/50 focus:border-rose"
          />
        ) : null}
        {/* 访客模式：这一页给不给不登录的人看 */}
        <button
          type="button"
          disabled={busy}
          onClick={() => setIsPublic((v) => !v)}
          aria-pressed={isPublic}
          title={isPublic ? "不登录的访客也能看到这一页（前提是栏目本身开了公开）" : `只有输密码进来的${READER_NAME}能看到这一页`}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-bold transition",
            isPublic
              ? "border-matcha bg-matcha/40 text-ink"
              : "border-ink/15 bg-paper text-ink-soft hover:bg-ink/5"
          )}
        >
          {isPublic ? <Eye weight="fill" className="size-4 text-ink" /> : <EyeSlash weight="fill" className="size-4" />}
          {isPublic ? "访客可见" : `仅${READER_NAME}可见`}
        </button>
      </div>

      {/* 日期与拍摄时间的对齐提示 */}
      {dateHint && (
        <p className="mt-2 px-1 text-xs leading-relaxed text-ink-soft/80">
          {dateHint}
          {dateSuggest && dateSuggest !== date && (
            <button
              type="button"
              onClick={() => {
                dateTouched.current = true;
                setDate(dateSuggest);
                showDateHint(`日期已改为 ${dateSuggest.replaceAll("-", ".")}`, null, 4000);
              }}
              className="ml-2 rounded-full bg-rose-soft px-2.5 py-0.5 font-bold text-rose-deep transition hover:opacity-80"
            >
              改用拍摄日期 {dateSuggest.replaceAll("-", ".")}
            </button>
          )}
        </p>
      )}

      {/* 正文 */}
      {isQuote ? (
        <div className="mt-5">
          <div className="mb-2.5 flex gap-2">
            {["她说", "我说", "我们"].map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => setSpeaker(s)}
                className={cn(
                  "rounded-full px-3.5 py-1 text-sm font-bold transition",
                  speaker === s ? "bg-peach text-ink shadow-sm" : "border border-ink/15 text-ink-soft hover:bg-ink/5"
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => indentOnTab(e, setBody)}
            placeholder="「今天的风好适合牵着手散步」"
            disabled={busy}
            rows={3}
            className="w-full resize-y rounded-2xl border-2 border-ink/10 bg-paper-warm px-4 py-3 text-[1.05rem] leading-relaxed outline-none placeholder:text-ink-soft/50 focus:border-butter"
          />
          {/* 语音备忘录：像微信那样点一下就能听 */}
          <div className="mt-3.5">
            <VoiceRecorder value={voice} onChange={changeVoice} disabled={busy} />
          </div>
        </div>
      ) : !isPhoto ? (
        /* 存照片不再写整组的一句话（和语录墙重复）：每张照片的描述在照片卡上单独改 */
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => indentOnTab(e, setBody)}
          placeholder={isLetter ? "展信安。\n\n今天想对你说的话，慢慢写……" : "今天发生了什么值得记住的事…\n\n空一行可以分段，**这样写**会变成粉色重点"}
          disabled={busy}
          rows={isLetter ? 12 : 6}
          className={cn(
            "mt-5 w-full resize-y border-2 bg-paper px-4 py-3.5 text-[1.05rem] leading-relaxed outline-none placeholder:text-ink-soft/50 focus:border-rose",
            isLetter ? "letter-paper rounded-lg border-butter" : "rounded-2xl border-ink/10"
          )}
        />
      ) : null}

      {/* 定时信：到那天她才能看到 */}
      {isLetter && (
        <div className="mt-4 rounded-2xl border border-butter bg-butter/25 px-4 py-3">
          <label className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-bold text-ink">什么时候能被拆开：</span>
            <input
              type="date"
              value={revealAt}
              onChange={(e) => setRevealAt(e.target.value)}
              disabled={busy}
              aria-label="拆信日期"
              className="rounded-full border border-ink/15 bg-paper px-3.5 py-1.5 font-round text-sm tracking-wider outline-none focus:border-rose"
            />
          </label>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
            留空 = 存进去马上就能看到；选一个日子（生日、纪念日），那天之前只有你在后台能看到它。
          </p>
        </div>
      )}

      {/* 心情贴纸 */}
      {type === "journal" && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-soft">今天的心情贴纸：</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMood("")}
            className={cn("rounded-full px-3 py-1 text-xs font-bold transition", mood === "" ? "bg-ink/10" : "text-ink-soft/70 hover:bg-ink/5")}
          >
            不贴
          </button>
          {STICKER_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              disabled={busy}
              onClick={() => setMood(mood === name ? "" : name)}
              aria-label={`贴纸 ${name}`}
              className={cn(
                "grid size-9 place-items-center rounded-full border-2 transition-all duration-300 ease-spring",
                mood === name ? "-translate-y-0.5 border-rose bg-rose-soft/60 shadow-sm" : "border-transparent hover:bg-ink/5"
              )}
            >
              <Sticker name={name} className={cn("size-5", MOOD_COLORS[name])} />
            </button>
          ))}
        </div>
      )}

      {/* 标签：语录和信不带 */}
      {!isQuote && !isLetter && <TagField tags={tags} onChange={setTags} knownTags={knownTags} onDeleteTag={onTagDelete} disabled={busy} />}

      {/* 照片：语录和信不带照片；整个区域可以拖文件 / 文件夹进来 */}
      {!isQuote && !isLetter && (
        <div
          className={cn("mt-6 rounded-3xl transition-colors", dragOn && "bg-rose-soft/40 ring-2 ring-rose/60 ring-offset-4 ring-offset-paper")}
          onDragOver={(e) => {
            if (busy) return;
            e.preventDefault();
            setDragOn(true);
          }}
          onDragLeave={(e) => {
            // 子元素间移动不算离开，只有真拖出这片区域才熄灭高亮
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOn(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOn(false);
            if (busy) return;
            void (async () => {
              const files = await filesFromDataTransfer(e.dataTransfer);
              const media = files.filter((f) => !f.name.startsWith("."));
              if (media.length === 0) return;
              toast(`收到 ${media.length} 个文件，正在准备预览…`);
              await addFiles(media);
            })();
          }}
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/*,.livp"
            multiple
            hidden
            onChange={(e) => void addFiles(e.target.files)}
          />
          {/* 文件夹多选：AirDrop / 导出的 Live Photo 对整个文件夹选进来，同名自动配对 */}
          <input
            ref={folderInput}
            type="file"
            multiple
            hidden
            onChange={(e) => void addFiles(e.target.files)}
            {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || analysis !== null}
              onClick={() => fileInput.current?.click()}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink/20 px-4 py-5 text-ink-soft transition hover:border-rose hover:bg-rose-soft/30 hover:text-ink"
            >
              <Camera weight="bold" className="size-5" />
              选照片 / 视频，或直接把文件 / 文件夹拖进这块区域（Live Photo 见下方提示）
            </button>
            <button
              type="button"
              disabled={busy || analysis !== null}
              onClick={() => folderInput.current?.click()}
              title="选整个文件夹：livp / 同名照片+视频对（IMG_xxx.HEIC + IMG_xxx.MOV）都会自动配对成 Live Photo"
              className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-ink/20 px-4 py-5 text-ink-soft transition hover:border-rose hover:bg-rose-soft/30 hover:text-ink"
            >
              <FolderOpen weight="bold" className="size-5" />
              选文件夹
            </button>
            {type === "journal" && album.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowPicker((v) => !v)}
                title="把已经传进本子的照片/视频引用到这一页"
                className={cn(
                  "flex items-center gap-2 rounded-2xl border-2 px-4 py-5 transition",
                  showPicker
                    ? "border-rose bg-rose-soft/40 text-ink"
                    : "border-dashed border-ink/20 text-ink-soft hover:border-rose hover:bg-rose-soft/30 hover:text-ink"
                )}
              >
                <Images weight="bold" className="size-5" />
                从本子里选
              </button>
            )}
          </div>
          {type === "journal" && showPicker && (
            <div className="mt-3 grid max-h-72 grid-cols-3 gap-3 overflow-y-auto rounded-2xl border border-ink/10 bg-paper p-3 sm:grid-cols-4 lg:grid-cols-6">
              {album.map((p) => {
                const used = items.some((x) => x.existing?.id === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addFromAlbum(p)}
                    title={used ? "已经选进这一页了" : (p.caption ?? "贴进这一页")}
                    className={cn(
                      "relative overflow-hidden rounded-lg border-2 transition-all duration-200",
                      used ? "border-matcha shadow-md" : "border-transparent opacity-70 hover:opacity-100"
                    )}
                  >
                    <AlbumPickThumb item={p} />
                    {p.kind === "video" && (
                      <span className="absolute left-1 top-1 rounded-full bg-ink/55 px-1.5 py-0.5 text-[9px] font-bold text-paper">视频</span>
                    )}
                    {used && (
                      <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-matcha text-ink">
                        <Check weight="bold" className="size-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-2 px-1 text-xs leading-relaxed text-ink-soft/80">
            {isPhoto && <>「存照片」保存时按每张卡片上的日期自动分成多页：默认取拍摄日期（探测完会自动填上），在卡片上直接改也行；没有拍摄时间的用上方选的日期。</>}
            {!isPhoto && (
              <>
                Live Photo：iPhone 相册里「存储到文件」只会导出静态图，视频部分会丢——这就是只拿到一个文件的原因。
                想留住实况：用 AirDrop 发到 Mac，或在 Mac「照片」App 里「文件 → 导出 → 导出未修改的原片」，
                把同名的一对文件（IMG_xxx.HEIC + IMG_xxx.MOV）一起选进来会自动配对；没有 Mac 就用 iCloud 网页版下载原图。
                如果导出的是 <strong>.livp</strong>（一个文件里包着照片+视频），直接选进来会自动拆开配对。
              </>
            )}
            HEIC 照片上传后自动转成 JPG，哪都能看；视频在电脑上放不了多半是 HEVC 编码，
            把 iPhone「设置 → 相机 → 格式」改成「兼容性最佳」再拍即可。
          </p>
          {pairHint && (
            <p className="mt-2 rounded-xl bg-matcha/30 px-4 py-2 text-sm font-bold text-ink">{pairHint}</p>
          )}

          {/* 分析中：只给进度条，不渲染缩略图（几百张一起解码会把浏览器卡死） */}
          {analysis?.status === "analyzing" && (
            <div className="mt-5 rounded-2xl border-2 border-dashed border-rose/40 bg-rose-soft/25 px-4 py-3.5">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-rose-deep">
                <SpinnerGap className="size-4 animate-spin" />
                正在分析这批文件（算指纹、查重复）
                <span className="font-round text-xs tracking-wider text-ink-soft">
                  {analysis.scanned} / {analysis.total}
                </span>
                <button
                  type="button"
                  onClick={abortAnalysis}
                  className="ml-auto rounded-full border border-rose-deep/40 px-3 py-1 text-xs font-bold text-rose-deep transition hover:bg-rose-soft"
                >
                  取消
                </button>
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rose-soft">
                <div
                  className="h-full rounded-full bg-rose-deep transition-all"
                  style={{ width: `${analysis.total ? Math.round((analysis.scanned / analysis.total) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-ink-soft">先不渲染缩略图浏览器就不会卡；分析完你确认了才开始上传</p>
            </div>
          )}

          {/* 分析完成：先给结论，确认了才上传（Live Photo 的照片+视频合起来算一项） */}
          {analysis?.status === "ready" && (
            <div className="mt-5 rounded-2xl border-2 border-butter bg-butter/25 px-4 py-3.5">
              <p className="text-sm font-bold text-ink">
                分析好了：这批共 <b className="text-rose-deep">{analysis.total}</b> 项（Live Photo 算一项，{analysis.total >= 100 ? "就是相册里会贴出的张数" : "和相册里的张数一致"}）
              </p>
              <ul className="mt-1.5 space-y-0.5 text-sm leading-relaxed text-ink-soft">
                <li>
                  <b className="text-ink">新增 {analysis.freshN} 项</b>，确认后开始上传
                  {analysis.oversizeN > 0 && `（另有 ${analysis.oversizeN} 个文件超过 ${MAX_UPLOAD_LABEL} 上限，传不了）`}
                </li>
                {analysis.dupN > 0 && <li>已传过 / 重复 {analysis.dupN} 项：内容和已有的完全一样，默认跳过（确认后在「已传过」标签里看）</li>}
                {analysis.suspectN > 0 && <li>疑似重复 {analysis.suspectN} 项：名字像但内容不同，默认跳过（想留的在「已传过」标签里点「仍然要传」）</li>}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={confirmUpload} className="btn-primary">
                  <UploadSimple weight="bold" className="size-5" />
                  开始上传{analysis.oversizeN > 0 ? `能传的 ${analysis.freshN} 项` : ` ${analysis.freshN} 项`}
                </button>
                <button
                  type="button"
                  onClick={abortAnalysis}
                  className="rounded-full border border-ink/15 px-4 py-2 text-sm text-ink-soft transition hover:bg-ink/5"
                >
                  不传这批了
                </button>
              </div>
            </div>
          )}

          {/* 预览区标签：要上传的 / 已传过·重复的 */}
          {visibleItems.length > 0 && dupPreviewItems.length > 0 && (
            <div className="mt-5 flex gap-2">
              {(
                [
                  ["new", `要上传的 ${newPreviewItems.length}`],
                  ["dup", `已传过 · 重复 ${dupPreviewItems.length}`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setPreviewFilter(value);
                    setRenderLimit(RENDER_CHUNK);
                  }}
                  aria-pressed={previewFilter === value}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-sm font-bold transition",
                    previewFilter === value ? "bg-rose-deep text-paper shadow-sm" : "border border-ink/15 text-ink-soft hover:bg-ink/5"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {shownItems.length > 0 && (
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {shownItems.map((item) => (
                <div key={item.key} className={cn("relative rounded-xl border border-ink/10 bg-white p-2 shadow-card", (item.dup || item.dupSuspect) && "grayscale opacity-60")}>
                  {item.kind === "video" ? (
                    <div className="relative">
                      {item.dup && (
                        <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-ink/60 px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] text-paper backdrop-blur">
                          {item.dup.id ? "已传过" : "重复文件"}
                        </span>
                      )}
                      {item.dupSuspect && (
                        <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-butter/95 px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] text-ink backdrop-blur">
                          疑似重复
                        </span>
                      )}
                      {item.previewBroken ? (
                        <div className="grid aspect-[4/3] place-items-center gap-1.5 rounded-lg bg-ink/5 px-3 text-center text-ink-soft">
                          <VideoCamera weight="duotone" className="size-8" />
                          <span className="text-xs leading-relaxed">
                            这个浏览器预览不了它{item.hevc || item.existing?.hevc ? "（HEVC 编码）" : ""}，用 iPhone / Mac 打开没问题
                          </span>
                        </div>
                      ) : (
                        <LazyPreviewVideo src={item.previewUrl} poster={item.existing?.posterUrl} onError={() => markPreviewBroken(item.key)} />
                      )}
                      {(item.hevc === true || item.existing?.hevc === true) && !item.pairedTo && (
                        <span
                          title="HEVC 编码：桌面 Chrome / Firefox 可能放不了，iPhone 和 Safari 没问题"
                          className="absolute bottom-1.5 left-1.5 rounded-full bg-butter/95 px-2 py-0.5 text-[10px] font-bold text-ink"
                        >
                          HEVC
                        </span>
                      )}
                      {item.pairedTo ? (
                        <span className="absolute left-1.5 top-1.5 rounded-full bg-rose-deep px-2 py-0.5 text-[10px] font-bold tracking-[0.15em] text-paper">
                          LIVE 已配对
                        </span>
                      ) : (
                        item.file && (
                          <button
                            type="button"
                            onClick={() => pairToNearest(item.key)}
                            aria-label="与前面的照片配对成 Live Photo"
                            title="与前面的照片配对成 Live Photo"
                            className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-paper/90 text-rose-deep shadow transition hover:scale-110"
                          >
                            <Link weight="bold" className="size-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="relative">
                      {item.dup && (
                        <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-ink/60 px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] text-paper backdrop-blur">
                          {item.dup.id ? "已传过" : "重复文件"}
                        </span>
                      )}
                      {item.dupSuspect && (
                        <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-butter/95 px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] text-ink backdrop-blur">
                          疑似重复
                        </span>
                      )}
                      {item.previewBroken ? (
                        livePreviewSrcOf(item) ? (
                          <video
                            src={`${livePreviewSrcOf(item)}#t=0.1`}
                            controls
                            muted
                            playsInline
                            preload="metadata"
                            className="aspect-[4/3] w-full rounded-lg bg-ink/5 object-cover"
                          />
                        ) : (
                          <div className="grid aspect-[4/3] place-items-center gap-1.5 rounded-lg bg-ink/5 px-3 text-center text-ink-soft">
                            <ImageSquare weight="duotone" className="size-8" />
                            <span className="text-xs leading-relaxed">HEIC 照片，这个浏览器显示不了；保存后会自动转成 JPG，哪都能看</span>
                          </div>
                        )
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={item.previewUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onError={() => markPreviewBroken(item.key)}
                          className="aspect-[4/3] w-full rounded-lg object-cover"
                        />
                      )}
                      {(item.pairVideoKey || item.existing?.liveVideo) && (
                        <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-ink/55 px-2 py-0.5 text-[10px] font-bold tracking-[0.18em] text-paper backdrop-blur">
                          <span className="size-1.5 rounded-full bg-rose" />
                          LIVE
                        </span>
                      )}
                      {item.pairVideoKey && (
                        <button
                          type="button"
                          onClick={() => unpair(item.key)}
                          className="absolute bottom-1.5 right-1.5 rounded-full bg-paper/90 px-2 py-0.5 text-[10px] font-bold text-ink-soft shadow transition hover:text-rose-deep"
                        >
                          取消配对
                        </button>
                      )}
                    </div>
                  )}
                  {isPhoto && (
                    <input
                      type="date"
                      value={item.userDate ?? item.takenAt ?? date}
                      onChange={(e) => patchItem(item.key, { userDate: e.target.value || undefined })}
                      disabled={busy || Boolean(item.dup) || Boolean(item.dupSuspect)}
                      aria-label="这张的日期"
                      title={item.takenAt ? `拍摄于 ${item.takenAt}，可改（保存时按这个日期分页）` : "没有拍摄时间，默认用上方选的日期，可改"}
                      className="mt-1.5 rounded-full bg-mist/60 px-2 py-0.5 font-round text-[10px] font-bold tracking-wider text-ink outline-none focus:bg-mist"
                    />
                  )}
                  <input
                    value={item.caption}
                    onChange={(e) => setCaption(item.key, e.target.value)}
                    placeholder={item.dup ? "已传过，这一页不会带它" : item.dupSuspect ? "疑似重复，默认不会上传" : "写句注释…"}
                    disabled={busy || Boolean(item.dup)}
                    className={cn(
                      "w-full rounded-md bg-paper px-2 py-1 font-script text-lg leading-tight outline-none placeholder:font-hand placeholder:text-sm placeholder:text-ink-soft/50",
                      !isPhoto && "mt-2"
                    )}
                  />
                  {item.dup ? (
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-round text-[11px] font-bold tracking-wider text-ink-soft">
                      {item.dup.id ? (
                        <>
                          <span className="rounded-full bg-mist/70 px-1.5 py-0.5 text-ink">已传过</span>
                          <span>{item.dup.entryDate ? `${item.dup.entryDate.replaceAll("-", ".")} 就在本子里` : "就在本子里"}</span>
                          <span className="font-normal opacity-70">不会重复上传</span>
                        </>
                      ) : (
                        <>
                          <span className="rounded-full bg-mist/70 px-1.5 py-0.5 text-ink">重复文件</span>
                          <span>和这一批里的「{item.dupBatchName}」一模一样</span>
                          <span className="font-normal opacity-70">只传一份</span>
                        </>
                      )}
                    </p>
                  ) : item.dupSuspect ? (
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-round text-[11px] font-bold tracking-wider text-ink-soft">
                      <span className="rounded-full bg-butter/80 px-1.5 py-0.5 text-ink">疑似重复</span>
                      <span className="font-normal opacity-70">名字像选重复的（内容不同），默认不上传</span>
                      <button
                        type="button"
                        onClick={() => restoreSuspect(item.key)}
                        disabled={busy}
                        className="shrink-0 rounded-full bg-rose-soft px-2 py-0.5 transition hover:opacity-80"
                      >
                        仍然要传
                      </button>
                    </p>
                  ) : (
                    <>
                  {item.fromRef && (
                    <p className="mt-0.5 font-round text-[10px] font-bold tracking-wider text-ink-soft/60">
                      从本子里选的 · 相册里的原文件不动
                    </p>
                  )}
                  {item.file && <UploadChip st={unitUpState(item)} onRetry={() => retryUnit(item)} />}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(item)}
                    disabled={busy}
                    aria-label="移除"
                    className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-rose-deep text-paper shadow-md transition hover:scale-110"
                  >
                    <X weight="bold" className="size-3.5" />
                  </button>
                </div>
              ))}
              {/* 触底续载的哨兵：滚到这里自动多渲染一批（懒加载） */}
              {shownItems.length < filterBase.length && <div ref={moreRef} className="h-2" />}
            </div>
          )}
          {shownItems.length < filterBase.length && (
            <p className="mt-3 text-center font-round text-xs font-bold tracking-wider text-ink-soft/70">
              先显示了 {shownItems.length} 张（共 {filterBase.length} 张），往下滚会继续加载
            </p>
          )}
        </div>
      )}

      {/* 后台上传总览：选完文件就在传了，这里只是让它看得见 */}
      {(phase === "uploading" || upStats.waiting + upStats.uploading + upStats.error > 0) && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-rose-deep">
            <SpinnerGap className="size-4 animate-spin" />
            {phase === "uploading" ? "正在传，马上就好…" : "后台上传中，先写描述不用等"}
            {uploadUnits.length > 0 && (
              <span className="font-round text-xs tracking-wider text-ink-soft">
                传好 {upStats.done} / {uploadUnits.length} 项
              </span>
            )}
            {(upStats.waiting > 0 || upStats.uploading > 0) && (
              <button
                type="button"
                onClick={cancelAllUploads}
                disabled={busy}
                className="ml-auto rounded-full border border-rose-deep/40 px-3 py-1 text-xs font-bold text-rose-deep transition hover:bg-rose-soft disabled:opacity-50"
                title="掐断没传完的、把刚传好的也从服务器撤下，整批回到没选之前"
              >
                取消整批上传
              </button>
            )}
          </div>
          {uploadUnits.length > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rose-soft">
              <div className="h-full rounded-full bg-rose-deep transition-all" style={{ width: `${upPct}%` }} />
            </div>
          )}
          {upStats.error > 0 && (
            <p className="mt-1.5 text-xs font-bold text-rose-deep">有 {upStats.error} 项没传上去，点卡片上的「重传」就好</p>
          )}
        </div>
      )}

      {error && <p className="mt-5 rounded-xl bg-rose-soft px-4 py-3 text-sm font-bold text-rose-deep">{error}</p>}

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || !canSubmit} className="btn-primary">
          {phase === "saving" ? (
            <>
              <SpinnerGap className="size-5 animate-spin" />
              正在贴进本子…
            </>
          ) : (
            <>
              <Check weight="bold" className="size-5" />
              {initial ? "保存修改" : "贴进手账"}
            </>
          )}
        </button>
        {initial && onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost">
            <ArrowLeft className="size-4" />
            不改了
          </button>
        )}
      </div>
    </form>
  );
}
