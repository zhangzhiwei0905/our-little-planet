"use client";

import { useRef, useState } from "react";
import {
  CalendarBlank,
  Check,
  FolderOpen,
  SpinnerGap,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/Toast";
import { MediaPicker } from "./MediaPicker";
import { readTakenAt } from "@/lib/media-date";
import { Sticker, STICKER_NAMES, STICKER_LABELS, type StickerName } from "@/components/journal/Sticker";
import { shrinkImage, uploadFile, expandLivp, fileFingerprint, lookupFingerprints } from "@/lib/client-upload";

export type MilestoneDTO = {
  id: string;
  title: string;
  body: string;
  date: string;
  icon: string | null;
  mediaIds: string[];
  /** 访客模式：public = 不登录也能看；缺省 = 仅她 */
  visibility?: "public" | "private";
  /** 入库/最后修改时间（ISO）：后台列表展示用 */
  createdAt?: string;
  updatedAt?: string;
};

/** 相册里可选的照片/视频（手账「从本子里选」「本子里的一切按张管理」也用这个形状） */
export type AlbumPickItem = {
  id: string;
  /** 这张的上传时间（ISO），按张管理行上展示 */
  createdAt?: string;
  url: string;
  thumbUrl?: string | null;
  posterUrl?: string | null;
  caption: string | null;
  kind: "photo" | "video";
  mime?: string;
  width?: number | null;
  height?: number | null;
  liveVideo?: string | null;
  hevc?: boolean | null;
  /** 所属日期（按张管理时改它 = 挪到那天的页面） */
  entryDate?: string;
  /** 这张媒体自己的标签 */
  tags?: string[];
};

function todayStr(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** 大事记表单：新建或编辑一条里程碑（在「写一页」和「本子里的一切」里用） */
export function MilestoneForm({
  initial,
  album,
  onSaved,
  onCancel,
  onAlbumGrow,
}: {
  initial?: MilestoneDTO | null;
  album: AlbumPickItem[];
  onSaved: () => void;
  onCancel: () => void;
  /** 直接上传的新照片/视频并进相册列表（它们也会出现在拍立得墙上） */
  onAlbumGrow: (item: AlbumPickItem) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [body, setBody] = useState(initial?.body ?? "");
  const [icon, setIcon] = useState<StickerName | "">(initial?.icon && STICKER_NAMES.includes(initial.icon as StickerName) ? (initial.icon as StickerName) : "");
  const [mediaIds, setMediaIds] = useState<string[]>(initial?.mediaIds ?? []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // 手动改过日期就不再自动设
  const dateTouched = useRef(Boolean(initial));

  const fieldCls =
    "w-full rounded-2xl border-2 border-ink/10 bg-paper px-4 py-2.5 outline-none placeholder:text-ink-soft/50 focus:border-rose";

  function toggle(id: string) {
    setMediaIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function uploadNew(list: FileList | null) {
    if (!list) return;
    // livp（iPhone 导出的 Live 图 zip 包）先拆成 照片+视频 再走上传
    let files = Array.from(list).filter((f) => !f.name.startsWith("."));
    const livps = files.filter((f) => /\.livp$/i.test(f.name));
    if (livps.length > 0) {
      files = files.filter((f) => !/\.livp$/i.test(f.name));
      const expanded = (await Promise.all(livps.map((f) => expandLivp(f).catch(() => [] as File[])))).flat();
      files = [...files, ...expanded];
      if (expanded.length > 0) toast(`已拆开 ${livps.length} 个 Live 图，会按「照片+视频」分别上传`);
    }
    let dupSkipped = 0;
    for (const f of files) {
      // 文件夹导入时 MIME 可能是空的，按扩展名兜底
      const isImage = f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(f.name);
      const isVideo = f.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(f.name);
      if (!isImage && !isVideo) continue;
      setUploading((n) => n + 1);
      try {
        // 第一个能读到拍摄时间的文件，顺手把大事记日期填上
        const taken = await readTakenAt(f);
        if (taken && !dateTouched.current) {
          dateTouched.current = true; // 只吃第一个文件的日期，后面不覆盖
          setDate(taken);
        }
        let file = f;
        if (isImage && /\.(heic|heif|jpe?g)$/i.test(f.name)) {
          file = (await shrinkImage(f)).file;
        }
        // 传过了的不再传：自动勾选本子里已有的那份
        const fp = await fileFingerprint(file);
        const hit = fp ? (await lookupFingerprints([fp]))[fp] : undefined;
        if (hit) {
          dupSkipped += 1;
          setMediaIds((prev) => (prev.includes(hit.id) ? prev : [...prev, hit.id]));
          continue;
        }
        const dto = await uploadFile(file, { fingerprint: fp || undefined });
        const item: AlbumPickItem = {
          id: dto.id,
          url: dto.url,
          caption: null,
          kind: dto.kind === "video" ? "video" : "photo",
          thumbUrl: dto.thumbUrl,
          posterUrl: dto.posterUrl,
        };
        onAlbumGrow(item);
        setMediaIds((prev) => [...prev, item.id]);
      } catch (e) {
        toast(e instanceof Error ? e.message : "没传上去", "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (dupSkipped > 0) toast(`跳过 ${dupSkipped} 个已传过的，已自动勾选本子里那份`);
    if (uploadInput.current) uploadInput.current.value = "";
    if (folderInput.current) folderInput.current.value = "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(initial ? `/api/milestones/${initial.id}` : "/api/milestones", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, date, icon: icon || null, mediaIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "保存失败了");
      toast(initial ? "大事记已更新" : "这个时刻记下了");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存失败了", "error");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card-paper max-w-2xl space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-bold text-ink-soft">这一天发生了什么</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={fieldCls} placeholder="我们的第一次一起看海" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold text-ink-soft">日期</label>
          <div className="relative">
            <CalendarBlank className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
            <input
              type="date"
              value={date}
              onChange={(e) => {
                dateTouched.current = true;
                setDate(e.target.value);
              }}
              className={`${fieldCls} pl-10`}
            />
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink-soft">多写两句（可不填）</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={`${fieldCls} resize-y`} placeholder="那天的风、那天的你……" />
      </div>

      <div>
        <p className="mb-1.5 text-sm font-bold text-ink-soft">挑个图标贴在时间轴上</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setIcon("")} className={cn("rounded-full px-3 py-1 text-xs font-bold transition", icon === "" ? "bg-ink/10" : "text-ink-soft/70 hover:bg-ink/5")}>
            不挑
          </button>
          {STICKER_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setIcon(name)}
              aria-label={STICKER_LABELS[name]}
              title={STICKER_LABELS[name]}
              className={cn(
                "grid size-9 place-items-center rounded-full border-2 transition-all duration-300 ease-spring",
                icon === name ? "-translate-y-0.5 border-rose bg-rose-soft/60 shadow-sm" : "border-transparent hover:bg-ink/5"
              )}
            >
              <Sticker name={name} className="size-5 text-rose-deep" />
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-ink-soft">配的照片 / 视频（已选 {mediaIds.length} 个，按点击顺序展示）</p>
          <button
            type="button"
            onClick={() => uploadInput.current?.click()}
            disabled={uploading > 0}
            className="btn-ghost gap-1.5 rounded-full px-3 py-1.5 text-xs"
          >
            {uploading > 0 ? <SpinnerGap className="size-3.5 animate-spin" /> : <UploadSimple weight="bold" className="size-3.5" />}
            {uploading > 0 ? `上传中 ×${uploading}` : "直接上传新的"}
          </button>
          <button
            type="button"
            onClick={() => folderInput.current?.click()}
            disabled={uploading > 0}
            title="选整个文件夹批量上传"
            className="btn-ghost gap-1.5 rounded-full px-3 py-1.5 text-xs"
          >
            <FolderOpen weight="bold" className="size-3.5" />
            文件夹
          </button>
        </div>
        <MediaPicker items={album} selected={mediaIds} onToggle={toggle} emptyHint="相册还空着，可以用下面按钮直接上传" />
        <input ref={uploadInput} type="file" accept="image/*,video/*,.livp" multiple hidden onChange={(e) => void uploadNew(e.target.files)} />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          onChange={(e) => void uploadNew(e.target.files)}
          {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? <SpinnerGap className="size-5 animate-spin" /> : <Check weight="bold" className="size-5" />}
          {initial ? "保存修改" : "记下这个时刻"}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          <X className="size-4" />
          取消
        </button>
      </div>
    </form>
  );
}

/** 大事记管理入口在「写一页」（新建）和「本子里的一切」（编辑/删除），列表不再放这儿 */
