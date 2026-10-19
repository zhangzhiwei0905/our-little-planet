"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowsCounterClockwise,
  CalendarBlank,
  Check,
  Cursor,
  FolderOpen,
  ImageSquare,
  PaintBrush,
  PencilSimple,
  Sticker as StickerIcon,
  TextAa,
  TrashSimple,
  UploadSimple,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/Toast";
import { Sticker, STICKER_NAMES, type StickerName } from "@/components/journal/Sticker";
import { boardElementStyle, BoardElementBody, BoardStrokesLayer, isStroke } from "@/components/journal/board-parts";
import {
  BOARD_COLORS,
  IMAGE_W,
  PEN_SIZES,
  STICKER_W,
  TEXT_SIZE,
  TEXT_W,
  type BoardElement,
  type BoardLayout,
} from "@/lib/board";
import { shrinkImage, uploadFile } from "@/lib/client-upload";
import type { EntryDTO } from "./EntryForm";

export type BoardEntryInitial = {
  id: string;
  title: string | null;
  entryDate: string;
  layout: BoardLayout | null;
  mediaIds: string[];
};

type Mode = "select" | "draw";

/** 非笔迹元素（可拖拽/缩放的实体）；笔迹没有位置盒子 */
type SolidEl = Exclude<BoardElement, { t: "stroke" }>;
type StrokeEl = Extract<BoardElement, { t: "stroke" }>;

let idSeq = 0;
const genId = () => `e${Date.now().toString(36)}${(idSeq++).toString(36)}`;

function todayStr(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** 自由拼贴页编辑器：一张 3:4 纸页上摆文字/图片/贴纸 + 手绘涂鸦。
 *  坐标归一化存储（x/w 相对页宽，y/h 相对页高），渲染走容器查询单位 */
export function BoardEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: BoardEntryInitial | null;
  onSaved: (entry: EntryDTO, isNew: boolean) => void;
  onCancel?: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.entryDate ?? todayStr());
  const [elements, setElements] = useState<BoardElement[]>(initial?.layout?.elements ?? []);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("select");
  const [colorIdx, setColorIdx] = useState(0);
  const [penIdx, setPenIdx] = useState(1);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [stickerColor, setStickerColor] = useState<string>(BOARD_COLORS[1].color);
  const [library, setLibrary] = useState<{ id: string; url: string; width: number | null; height: number | null }[]>([]);

  const pageRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<BoardElement[][]>([]);
  const dragRef = useRef<{
    id: string;
    kind: "move" | "resize";
    nx: number;
    ny: number;
    orig: SolidEl;
  } | null>(null);
  const strokeRef = useRef<{ color: string; size: number; pts: number[][] } | null>(null);
  const [currentStroke, setCurrentStroke] = useState<StrokeEl | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageFolderInput = useRef<HTMLInputElement>(null);
  const stickerInput = useRef<HTMLInputElement>(null);
  // 贴纸依次错开摆放，避免全叠在同一点
  const stickerSeq = useRef(0);
  // 长按删除贴纸：按住 550ms 触发，触发后吞掉随后的 click（不然会贴出去）
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  // 贴纸库：上传过的贴纸跨页面复用
  useEffect(() => {
    fetch("/api/stickers")
      .then((r) => (r.ok ? r.json() : { stickers: [] }))
      .then((d: { stickers?: { id: string; url: string; width: number | null; height: number | null }[] }) =>
        setLibrary(d.stickers ?? [])
      )
      .catch(() => undefined);
  }, []);

  const busy = saving || uploading > 0;

  const pushHistory = useCallback(() => {
    historyRef.current.push(elements);
    if (historyRef.current.length > 50) historyRef.current.shift();
  }, [elements]);

  function undo() {
    const prev = historyRef.current.pop();
    if (!prev) return;
    setElements(prev);
    setSelected(null);
    setEditingText(null);
  }

  function ptr(e: React.PointerEvent): { nx: number; ny: number } {
    const r = pageRef.current!.getBoundingClientRect();
    return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height };
  }

  const clampX = (v: number) => Math.min(1.15, Math.max(-0.15, v));
  const clampY = (v: number) => Math.min(1.15, Math.max(-0.15, v));

  function patchElement(id: string, patch: Record<string, number | string>) {
    setElements((prev) => prev.map((e) => (e.id === id ? ({ ...e, ...patch } as BoardElement) : e)));
  }

  /* ---------- 元素增删 ---------- */

  function addElement(el: BoardElement, select = true) {
    pushHistory();
    setElements((prev) => [...prev, el]);
    if (select) setSelected(el.id);
    setMode("select");
  }

  function addText() {
    const el: BoardElement = {
      id: genId(),
      t: "text",
      x: 0.15,
      y: 0.12,
      w: TEXT_W,
      text: "",
      font: "hand",
      size: TEXT_SIZE,
      color: BOARD_COLORS[colorIdx].color,
    };
    addElement(el);
    setDraft("");
    setEditingText(el.id);
  }

  function addSticker(name: StickerName, color: string) {
    setStickerOpen(false);
    // 固定初始大小贴出来，之后可拖拽缩放；位置按顺序错开，不叠在一起
    const i = stickerSeq.current++;
    addElement({
      id: genId(),
      t: "sticker",
      x: 0.2 + (i % 5) * 0.09,
      y: 0.2 + Math.floor(i / 5) * 0.13,
      w: STICKER_W,
      name,
      color,
    });
  }

/** 探一下图片真实宽高（shrinkImage 解不了的 png/webp 用这个），入库后贴纸能保持原始比例 */
async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : {};
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

  /** 传图片（普通素材）或贴纸（进贴纸库，长期复用）；jpeg/heic 先在浏览器压一道（能解的话） */
  async function addImageFiles(files: FileList | File[] | null, asSticker: boolean, at?: { x: number; y: number }) {
    if (!files || files.length === 0) return;
    let placed = 0;
    for (const f of Array.from(files)) {
      if (f.name.startsWith(".")) continue; // .DS_Store 之类
      // 文件夹导入时 MIME 可能是空的，按扩展名兜底
      const isImg = f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(f.name);
      if (!isImg) continue;
      setUploading((n) => n + 1);
      try {
        let file = f;
        let dims = { width: 0, height: 0 };
        if (/\.(heic|heif|jpe?g)$/i.test(f.name)) {
          const shrunk = await shrinkImage(f);
          file = shrunk.file;
          dims = { width: shrunk.width, height: shrunk.height };
        }
        if (!dims.width) {
          const probed = await imageSize(f);
          dims = { width: probed.width ?? 0, height: probed.height ?? 0 };
        }
        const dto = await uploadFile(file, { sticker: asSticker, asset: !asSticker, width: dims.width, height: dims.height });
        const w = asSticker ? STICKER_W : IMAGE_W;
        const ratio = dto.width && dto.height ? (dto.height / dto.width) * 0.75 : 0.6;
        addElement(
          {
            id: genId(),
            t: "image",
            x: clampX((at?.x ?? 0.35) + placed * 0.04 - w / 2),
            y: clampY((at?.y ?? 0.25) + placed * 0.04),
            w,
            h: ratio * w,
            media: dto.id,
          },
          !asSticker
        );
        if (asSticker) {
          // 进贴纸库，下次直接用
          setLibrary((prev) => [{ id: dto.id, url: dto.url, width: dto.width, height: dto.height }, ...prev]);
        }
        placed++;
      } catch (e) {
        toast(e instanceof Error ? e.message : "图片没传上去", "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  /** 从贴纸库贴一张（固定初始大小，之后可缩放） */
  function placeLibrarySticker(s: { id: string; width: number | null; height: number | null }) {
    if (longPressed.current) return; // 刚触发过长按删除，别贴出去
    const i = stickerSeq.current++;
    const w = STICKER_W;
    const h = s.width && s.height ? w * (s.height / s.width) * 0.75 : w * 0.75;
    addElement({
      id: genId(),
      t: "image",
      x: 0.2 + (i % 5) * 0.09,
      y: 0.2 + Math.floor(i / 5) * 0.13,
      w,
      h,
      media: s.id,
    });
  }

  /** 长按从贴纸库删除 */
  async function deleteLibrarySticker(id: string) {
    if (!window.confirm("从贴纸库里删掉这张贴纸？")) return;
    try {
      const res = await fetch(`/api/stickers/${id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "没删掉");
      setLibrary((prev) => prev.filter((s) => s.id !== id));
      toast("贴纸已删掉");
    } catch (e) {
      toast(e instanceof Error ? e.message : "没删掉", "error");
    }
  }

  function libraryPressDown(id: string) {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      void deleteLibrarySticker(id);
    }, 550);
  }

  function libraryPressUp() {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function removeSelected() {
    if (!selected) return;
    pushHistory();
    setElements((prev) => prev.filter((e) => e.id !== selected));
    setSelected(null);
    setEditingText(null);
  }

  /* ---------- 文字编辑 ---------- */

  function startTextEdit(el: BoardElement) {
    if (el.t !== "text") return;
    setSelected(el.id);
    setDraft(el.text);
    setEditingText(el.id);
  }

  function commitTextDraft() {
    if (!editingText) return;
    const id = editingText;
    setEditingText(null);
    setElements((prev) => {
      const el = prev.find((e) => e.id === id);
      if (el && el.t === "text" && el.text !== draft) return prev.map((e) => (e.id === id ? { ...e, text: draft } : e));
      // 空文字直接不留
      return prev.filter((e) => e.id !== id || e.t !== "text" || e.text !== "");
    });
  }

  /* ---------- 键盘 ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        if (e.key === "Escape") (target as HTMLTextAreaElement).blur();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (e.key === "Escape") {
        setSelected(null);
        setStickerOpen(false);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, elements]);

  /* ---------- 保存 ---------- */

  async function save() {
    if (busy) return;
    // 页面上引用的图片素材挂到条目（随条目删除）；贴纸库的图不挂（长期复用，随库管理）
    const imageIds = new Set(elements.filter((e) => e.t === "image").map((e) => e.media));
    const libIds = new Set(library.map((s) => s.id));
    const attachIds = [...imageIds].filter((id) => !libIds.has(id));
    setSaving(true);
    try {
      const payload = {
        type: "board" as const,
        title: title || undefined,
        body: "",
        entryDate: date,
        media: attachIds.map((id, i) => ({ id, caption: null, sort: i })),
        removeMediaIds: initial ? initial.mediaIds.filter((id) => !imageIds.has(id)) : [],
        layout: { elements },
      };
      const res = await fetch(initial ? `/api/entries/${initial.id}` : "/api/entries", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "保存失败了");
      toast(initial ? "改好了，已保存" : "这一页拼好了");
      onSaved(data.entry, !initial);
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存失败了", "error");
      setSaving(false);
    }
  }

  /* ---------- 画布交互 ---------- */

  function startElementDrag(e: React.PointerEvent, el: BoardElement, kind: "move" | "resize") {
    if (mode !== "select" || el.t === "stroke") return;
    e.stopPropagation();
    e.preventDefault();
    commitTextDraft();
    setSelected(el.id);
    pushHistory();
    const p = ptr(e);
    dragRef.current = { id: el.id, kind, nx: p.nx, ny: p.ny, orig: { ...el } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onDragMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const p = ptr(e);
    const dx = p.nx - d.nx;
    const dy = p.ny - d.ny;
    if (d.kind === "move") {
      patchElement(d.id, { x: clampX(d.orig.x + dx), y: clampY(d.orig.y + dy) });
      return;
    }
    // 缩放：按宽度增量的比例等比缩（文字是字号，图片连高度）
    const orig = d.orig;
    if (orig.t === "image") {
      const w = Math.min(1.2, Math.max(0.05, orig.w + dx));
      patchElement(d.id, { w, h: orig.h * (w / orig.w) });
    } else if (orig.t === "sticker") {
      patchElement(d.id, { w: Math.min(1, Math.max(0.04, orig.w + dx)) });
    } else if (orig.t === "text") {
      const w = Math.min(1, Math.max(0.1, orig.w + dx));
      patchElement(d.id, { w, size: Math.min(0.2, Math.max(0.02, orig.size * (w / orig.w))) });
    }
  }

  function endDrag() {
    dragRef.current = null;
  }

  function startStroke(e: React.PointerEvent) {
    if (mode !== "draw") return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = ptr(e);
    const s = { color: BOARD_COLORS[colorIdx].color, size: PEN_SIZES[penIdx], pts: [[p.nx, p.ny]] };
    strokeRef.current = s;
    setCurrentStroke({ id: "__current", t: "stroke", ...s });
  }

  function onStrokeMove(e: React.PointerEvent) {
    const s = strokeRef.current;
    if (!s) return;
    const p = ptr(e);
    s.pts.push([p.nx, p.ny]);
    setCurrentStroke({ id: "__current", t: "stroke", color: s.color, size: s.size, pts: [...s.pts] });
  }

  function endStroke() {
    const s = strokeRef.current;
    strokeRef.current = null;
    setCurrentStroke(null);
    if (s && s.pts.length > 0) {
      pushHistory();
      setElements((prev) => [...prev, { id: genId(), t: "stroke", ...s }]);
    }
  }

  const selectedEl = elements.find((e) => e.id === selected) ?? null;
  const strokes = elements.filter(isStroke);

  return (
    <div className="card-paper">
      {/* 顶部信息 */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-3.5 py-2">
          <CalendarBlank className="size-4 text-ink-soft" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
            aria-label="日期"
            className="bg-transparent font-round text-sm tracking-wider outline-none"
          />
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="给这一页起个标题（可不填）"
          disabled={busy}
          className="min-w-40 flex-1 rounded-full border border-ink/15 bg-paper px-4 py-2 text-sm outline-none placeholder:text-ink-soft/50 focus:border-rose"
        />
      </div>

      {/* 工具条 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-ink/15 bg-paper p-1">
          <button
            type="button"
            onClick={() => setMode("select")}
            aria-label="选择/移动模式"
            className={cn(
              "grid size-8 place-items-center rounded-full transition",
              mode === "select" ? "bg-rose-soft text-rose-deep" : "text-ink-soft hover:bg-ink/5"
            )}
          >
            <Cursor className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("draw");
              setSelected(null);
              commitTextDraft();
            }}
            aria-label="画笔模式"
            className={cn(
              "grid size-8 place-items-center rounded-full transition",
              mode === "draw" ? "bg-rose-soft text-rose-deep" : "text-ink-soft hover:bg-ink/5"
            )}
          >
            <PaintBrush className="size-4" />
          </button>
        </div>

        {mode === "draw" ? (
          <div className="flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-3 py-1.5">
            {BOARD_COLORS.map((c, i) => (
              <button
                key={c.color}
                type="button"
                aria-label={`画笔 ${c.label}`}
                onClick={() => setColorIdx(i)}
                className={cn(
                  "size-6 rounded-full border-2 transition",
                  colorIdx === i ? "scale-110 border-ink" : "border-transparent opacity-70"
                )}
                style={{ backgroundColor: c.color }}
              />
            ))}
            <span className="h-5 w-px bg-ink/15" />
            {PEN_SIZES.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`粗细 ${i + 1}`}
                onClick={() => setPenIdx(i)}
                className={cn("grid size-7 place-items-center rounded-full transition", penIdx === i ? "bg-ink/10" : "opacity-60")}
              >
                <span className={cn("rounded-full bg-ink", i === 0 ? "size-1" : i === 1 ? "size-2" : "size-3.5")} />
              </button>
            ))}
          </div>
        ) : (
          <>
            <button type="button" onClick={addText} disabled={busy} className="btn-ghost gap-1.5 rounded-full px-3.5 py-2 text-sm">
              <TextAa weight="bold" className="size-4" />
              文字
            </button>
            <button
              type="button"
              onClick={() => imageInput.current?.click()}
              disabled={busy}
              className="btn-ghost gap-1.5 rounded-full px-3.5 py-2 text-sm"
            >
              <ImageSquare weight="bold" className="size-4" />
              图片
            </button>
            <button
              type="button"
              onClick={() => imageFolderInput.current?.click()}
              disabled={busy}
              title="选整个文件夹，批量贴图"
              className="btn-ghost gap-1.5 rounded-full px-3.5 py-2 text-sm"
            >
              <FolderOpen weight="bold" className="size-4" />
              文件夹
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setStickerOpen((v) => !v)}
                disabled={busy}
                className={cn("btn-ghost gap-1.5 rounded-full px-3.5 py-2 text-sm", stickerOpen && "bg-rose-soft text-rose-deep")}
              >
                <StickerIcon weight="bold" className="size-4" />
                贴纸
              </button>
              {stickerOpen && (
                <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-2xl border border-ink/10 bg-paper p-3 shadow-lifted">
                  <p className="px-1 pb-2 text-xs text-ink-soft">先选颜色，再点贴纸贴出来（贴出来后拖角缩放）</p>
                  <div className="mb-2.5 flex items-center gap-2 px-1">
                    {BOARD_COLORS.map((c) => (
                      <button
                        key={c.color}
                        type="button"
                        aria-label={`贴纸颜色 ${c.label}`}
                        onClick={() => setStickerColor(c.color)}
                        className={cn(
                          "size-6 rounded-full border-2 transition",
                          stickerColor === c.color ? "scale-110 border-ink" : "border-transparent opacity-70"
                        )}
                        style={{ backgroundColor: c.color }}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {STICKER_NAMES.map((name) => (
                      <button
                        key={name}
                        type="button"
                        aria-label={`贴纸 ${name}`}
                        onClick={() => addSticker(name, stickerColor)}
                        className="grid place-items-center rounded-xl border border-ink/10 bg-card py-2 transition hover:-translate-y-0.5 hover:border-rose"
                        style={{ color: stickerColor }}
                      >
                        <Sticker name={name} className="size-7" />
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 px-1 pb-1.5 text-xs text-ink-soft">我的贴纸（长按删除）</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {library.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        aria-label="贴这张贴纸"
                        onClick={() => placeLibrarySticker(s)}
                        onPointerDown={() => libraryPressDown(s.id)}
                        onPointerUp={libraryPressUp}
                        onPointerLeave={libraryPressUp}
                        onPointerCancel={libraryPressUp}
                        className="grid place-items-center rounded-xl border border-ink/10 bg-card p-1.5 transition hover:-translate-y-0.5 hover:border-rose [touch-action:manipulation]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.url} alt="" draggable={false} className="size-9 object-contain" />
                      </button>
                    ))}
                    {library.length === 0 && (
                      <p className="col-span-3 pb-1 text-center text-xs text-ink-soft/70">还没有，传一张试试</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => stickerInput.current?.click()}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/25 py-2 text-xs font-bold text-ink-soft transition hover:border-rose hover:text-ink"
                  >
                    <UploadSimple weight="bold" className="size-3.5" />
                    上传可爱图片当贴纸
                  </button>
                </div>
              )}
            </div>
            {selectedEl?.t === "text" && (
              <button
                type="button"
                onClick={() => startTextEdit(selectedEl)}
                className="btn-ghost gap-1.5 rounded-full px-3.5 py-2 text-sm"
              >
                <PencilSimple weight="bold" className="size-4" />
                改文字
              </button>
            )}
          </>
        )}

        <button
          type="button"
          onClick={undo}
          className="btn-ghost gap-1.5 rounded-full px-3.5 py-2 text-sm"
          title="撤销（Ctrl/⌘+Z）"
        >
          <ArrowsCounterClockwise weight="bold" className="size-4" />
          撤销
        </button>
        {mode === "select" && selected && (
          <button
            type="button"
            onClick={removeSelected}
            className="btn-ghost gap-1.5 rounded-full px-3.5 py-2 text-sm text-rose-deep hover:bg-rose-soft"
          >
            <TrashSimple weight="bold" className="size-4" />
            删除
          </button>
        )}
        {uploading > 0 && <span className="text-xs font-bold text-rose-deep">素材上传中 ×{uploading}</span>}
      </div>

      {/* 画布。手机上画描最容易误触成长按选中网页文字：禁掉选中和 iOS 长按菜单，
          画的时候指针事件才全是自己的（文字元素的输入框不受影响，照样能选能改） */}
      <div
        ref={pageRef}
        className="board-page relative mt-5 w-full touch-pan-y overflow-hidden rounded-xl border border-ink/10 shadow-card select-none [-webkit-touch-callout:none] [-webkit-user-select:none]"
        onPointerDown={() => {
          commitTextDraft();
          setSelected(null);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const r = pageRef.current!.getBoundingClientRect();
          void addImageFiles(e.dataTransfer.files, false, {
            x: (e.clientX - r.left) / r.width,
            y: (e.clientY - r.top) / r.height,
          });
        }}
      >
        {elements.filter((e) => !isStroke(e)).map((el) => (
          <div
            key={el.id}
            style={{ ...boardElementStyle(el), zIndex: selected === el.id ? 20 : undefined }}
            className={cn(
              "[touch-action:none]",
              mode === "select" && "cursor-move",
              selected === el.id && "outline-2 outline-dashed outline-rose-deep/60 outline-offset-2"
            )}
            onPointerDown={(e) => startElementDrag(e, el, "move")}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => startTextEdit(el)}
          >
            {editingText === el.id && el.t === "text" ? (
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitTextDraft}
                rows={Math.max(2, draft.split("\n").length)}
                className="w-full resize-none rounded-md bg-white/60 leading-snug outline-none"
                style={{ fontSize: `${el.size * 100}cqw`, color: el.color }}
              />
            ) : (
              <BoardElementBody el={el} />
            )}
            {selected === el.id && mode === "select" && (
              <span
                role="button"
                aria-label="缩放"
                onPointerDown={(e) => startElementDrag(e, el, "resize")}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className="absolute -bottom-2.5 -right-2.5 z-30 grid size-5 cursor-nwse-resize place-items-center rounded-full bg-rose-deep text-paper shadow-md"
              >
                <span className="size-1.5 border-r-2 border-b-2 border-paper" />
              </span>
            )}
          </div>
        ))}

        <BoardStrokesLayer elements={currentStroke ? [...strokes, currentStroke] : strokes} />

        {mode === "draw" && (
          <div
            className="absolute inset-0 z-40 cursor-crosshair [touch-action:none]"
            onPointerDown={startStroke}
            onPointerMove={onStrokeMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
          />
        )}
      </div>

      <p className="mt-2 px-1 text-xs leading-relaxed text-ink-soft/80">
        画笔下可以随手涂鸦；选择模式下拖动元素、拖右下角圆点缩放，双击文字修改。图片可以直接拖进纸页。
      </p>

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addImageFiles(e.target.files ?? [], false);
          e.target.value = "";
        }}
      />
      <input
        ref={imageFolderInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void addImageFiles(e.target.files ?? [], false);
          e.target.value = "";
        }}
        {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
      />
      <input
        ref={stickerInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void addImageFiles(e.target.files ?? [], true);
          e.target.value = "";
        }}
      />

      {/* 保存 */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={busy} className="btn-primary">
          {saving || uploading > 0 ? (
            <>
              <Check className="size-5 animate-pulse" />
              {saving ? "正在贴进本子…" : "素材还在传…"}
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
            不改了
          </button>
        )}
      </div>
    </div>
  );
}
