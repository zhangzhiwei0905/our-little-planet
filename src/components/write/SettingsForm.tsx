"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FloppyDisk, MusicNotes, Trash, UploadSimple } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import { uploadFile, type MediaDTO } from "@/lib/client-upload";
import type { SiteSettings } from "@/lib/settings";
import { READER_NAME } from "@/lib/reader";

/** 本子信息（彩蛋已独立到「彩蛋」标签页管理） */
export function SettingsForm({ initial }: { initial: SiteSettings }) {
  const toast = useToast();
  const [title, setTitle] = useState(initial.title);
  const [names, setNames] = useState(initial.names);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [hideQuoteDate, setHideQuoteDate] = useState(initial.quotesHideDate === "1");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  // 访客模式：六个栏目对不登录的访客是否公开 + 访客进门的一句话
  const [guestOpen, setGuestOpen] = useState({
    home: initial.guestHome === "1",
    journal: initial.guestJournal === "1",
    album: initial.guestAlbum === "1",
    quotes: initial.guestQuotes === "1",
    letters: initial.guestLetters === "1",
    timeline: initial.guestTimeline === "1",
    screenings: initial.guestScreenings === "1",
  });
  const [guestWelcome, setGuestWelcome] = useState(initial.guestWelcome);

  // 背景音乐：新传的先放本地，保存时才落到 settings；换歌/移除的旧文件保存成功后再删
  const [bgmTitle, setBgmTitle] = useState(initial.bgmTitle);
  const [bgmLyrics, setBgmLyrics] = useState(initial.bgmLyrics);
  const [bgmNew, setBgmNew] = useState<MediaDTO | null>(null);
  const [bgmNewName, setBgmNewName] = useState("");
  const [bgmRemoved, setBgmRemoved] = useState(false);
  const [bgmUploading, setBgmUploading] = useState(false);
  const bgmAudioInput = useRef<HTMLInputElement>(null);
  const bgmLrcInput = useRef<HTMLInputElement>(null);
  // 传好了但从没保存的文件：离开表单时删掉，别留在库里当孤儿
  const bgmPendingRef = useRef<MediaDTO | null>(null);
  useEffect(() => {
    bgmPendingRef.current = bgmNew;
  }, [bgmNew]);
  useEffect(() => {
    const pending = bgmPendingRef;
    return () => {
      const dto = pending.current;
      if (dto) void fetch(`/api/media/${dto.id}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    };
  }, []);

  async function pickBgm(file: File | undefined) {
    if (!file) return;
    if (!(file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(file.name))) {
      toast("选一个音频文件（mp3 / m4a / wav…）", "error");
      return;
    }
    setBgmUploading(true);
    try {
      const dto = await uploadFile(file);
      setBgmNew(dto);
      setBgmNewName(file.name);
      setBgmRemoved(false);
      toast("传好了，别忘了点下面的保存");
    } catch (e) {
      toast(e instanceof Error ? e.message : "上传失败", "error");
    } finally {
      setBgmUploading(false);
    }
  }

  async function pickLrc(file: File | undefined) {
    if (!file) return;
    const text = await file.text().catch(() => "");
    if (!text.trim()) {
      toast("这个文件读不出歌词", "error");
      return;
    }
    setBgmLyrics(text.slice(0, 20000));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError("");
    try {
      const bgmMediaId = bgmNew ? bgmNew.id : bgmRemoved ? "" : initial.bgmMediaId;
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          names,
          startDate,
          quotesHideDate: hideQuoteDate ? "1" : "0",
          guestHome: guestOpen.home ? "1" : "0",
          guestJournal: guestOpen.journal ? "1" : "0",
          guestAlbum: guestOpen.album ? "1" : "0",
          guestQuotes: guestOpen.quotes ? "1" : "0",
          guestLetters: guestOpen.letters ? "1" : "0",
          guestTimeline: guestOpen.timeline ? "1" : "0",
          guestScreenings: guestOpen.screenings ? "1" : "0",
          guestWelcome: guestWelcome.slice(0, 200),
          bgmMediaId,
          bgmTitle: bgmTitle.slice(0, 120),
          bgmLyrics: bgmLyrics.slice(0, 20000),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "保存失败了");
      }
      // 换歌或移除：旧文件已经没有引用，删掉（失败也不影响配置，最多留个孤儿文件）
      const replaced = initial.bgmMediaId && initial.bgmMediaId !== bgmMediaId ? initial.bgmMediaId : null;
      if (replaced) void fetch(`/api/media/${replaced}`, { method: "DELETE" }).catch(() => undefined);
      bgmPendingRef.current = null;
      setState("saved");
      toast("本子信息已保存");
      setTimeout(() => setState("idle"), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败了");
      setState("error");
      toast(e instanceof Error ? e.message : "保存失败了", "error");
    }
  }

  const fieldCls =
    "w-full rounded-2xl border-2 border-ink/10 bg-paper px-4 py-2.5 outline-none placeholder:text-ink-soft/50 focus:border-rose";
  const labelCls = "mb-1.5 block text-sm font-bold text-ink-soft";
  const hasBgm = Boolean(bgmNew) || (Boolean(initial.bgmMediaId) && !bgmRemoved);

  return (
    <form onSubmit={submit} className="card-paper max-w-lg space-y-6">
      <div>
        <label className={labelCls} htmlFor="set-title">
          本子的名字（首页大标题）
        </label>
        <input id="set-title" value={title} onChange={(e) => setTitle(e.target.value)} className={fieldCls} placeholder="我们的小星球" />
      </div>
      <div>
        <label className={labelCls} htmlFor="set-names">
          封面上的两个人
        </label>
        <input id="set-names" value={names} onChange={(e) => setNames(e.target.value)} className={fieldCls} placeholder="小张 ♥ 小星" />
      </div>
      <div>
        <label className={labelCls} htmlFor="set-date">
          在一起的纪念日（首页天数从这天开始算）
        </label>
        <input id="set-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldCls} />
      </div>

      {/* 语录墙隐藏日期：整批导入的语录都是同一天时，墙上一排同日期不好看 */}
      <button
        type="button"
        onClick={() => setHideQuoteDate((v) => !v)}
        aria-pressed={hideQuoteDate}
        className="flex w-full items-center justify-between gap-4 rounded-2xl border-2 border-ink/10 bg-paper px-4 py-3 text-left transition hover:border-ink/25"
      >
        <span>
          <span className="block text-sm font-bold">语录便利贴上不显示日期</span>
          <span className="mt-0.5 block text-xs text-ink-soft">批量导入的语录全是同一天时，墙上一排同日期不好看</span>
        </span>
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${hideQuoteDate ? "bg-rose-deep" : "bg-ink/20"}`}
          aria-hidden
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-paper shadow transition-all ${hideQuoteDate ? "left-[22px]" : "left-0.5"}`}
          />
        </span>
      </button>

      {/* 访客模式：哪些栏目不登录也能看。没开的栏目对访客整栏消失（数据也不会渲染） */}
      <fieldset className="rounded-2xl border-2 border-dashed border-mist bg-mist/15 px-4 py-4">
        <legend className="px-1.5 text-sm font-bold text-ink">访客模式</legend>
        <p className="mb-3.5 text-xs leading-relaxed text-ink-soft">
          开着的栏目，她的同事朋友不输密码就能看；关着的栏目只在导航里出现给{READER_NAME}。
          栏目开了之后，具体每一页还能在「写一页」表单和「本子里的一切」里单独设公开或仅{READER_NAME}可见。
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { key: "home", label: "首页", desc: "天数、本月结算这些" },
              { key: "journal", label: "手账", desc: "日记页和自由拼贴" },
              { key: "album", label: "相册", desc: "拍立得墙" },
              { key: "quotes", label: "语录", desc: "便利贴和语音" },
              { key: "letters", label: "信箱", desc: "信和她的回话" },
              { key: "timeline", label: "大事记", desc: "里程碑时间轴" },
              { key: "screenings", label: "放映室", desc: "纪念视频的首映" },
            ] as const
          ).map(({ key, label, desc }) => (
            <button
              key={key}
              type="button"
              onClick={() => setGuestOpen((s) => ({ ...s, [key]: !s[key] }))}
              aria-pressed={guestOpen[key]}
              className="flex items-center justify-between gap-3 rounded-2xl border-2 border-ink/10 bg-paper px-3.5 py-2.5 text-left transition hover:border-ink/25"
            >
              <span>
                <span className="block text-sm font-bold">{label}</span>
                <span className="mt-0.5 block text-xs text-ink-soft">{desc}</span>
              </span>
              <span
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${guestOpen[key] ? "bg-rose-deep" : "bg-ink/20"}`}
                aria-hidden
              >
                <span
                  className={`absolute top-0.5 size-5 rounded-full bg-paper shadow transition-all ${guestOpen[key] ? "left-[22px]" : "left-0.5"}`}
                />
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3.5">
          <label className={labelCls} htmlFor="set-guest-welcome">
            访客进门看到的一句话（首页没公开时显示）
          </label>
          <input
            id="set-guest-welcome"
            value={guestWelcome}
            onChange={(e) => setGuestWelcome(e.target.value.slice(0, 200))}
            className={fieldCls}
            placeholder="欢迎来我们的小星球做客，这里有一小部分摊开给你看"
            maxLength={200}
          />
        </div>
      </fieldset>

      {/* 大事记的背景音乐：自托管一首 mp3 + LRC 歌词 */}
      <fieldset className="rounded-2xl border-2 border-dashed border-rose/40 bg-rose-soft/25 px-4 py-4">
        <legend className="px-1.5 text-sm font-bold text-rose-deep">大事记的背景音乐</legend>

        <div className="flex flex-wrap items-center gap-2.5">
          {hasBgm ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1.5 text-sm font-bold text-ink shadow-sm">
                <MusicNotes weight="fill" className="size-4 text-rose-deep" />
                {bgmNew ? `新歌：${bgmNewName}` : "已配置一首背景音乐"}
              </span>
              <button
                type="button"
                onClick={() => bgmAudioInput.current?.click()}
                disabled={bgmUploading}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 px-3 py-1.5 text-sm text-ink-soft transition hover:bg-ink/5"
              >
                <UploadSimple weight="bold" className="size-4" />
                换一首
              </button>
              <button
                type="button"
                onClick={() => {
                  setBgmRemoved(true);
                  setBgmNew(null);
                  setBgmNewName("");
                }}
                disabled={bgmUploading}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 px-3 py-1.5 text-sm text-ink-soft transition hover:bg-ink/5"
              >
                <Trash weight="bold" className="size-4" />
                移除
              </button>
            </>
          ) : bgmRemoved && initial.bgmMediaId ? (
            <span className="text-sm text-ink-soft">保存后就没有背景音乐了</span>
          ) : (
            <button
              type="button"
              onClick={() => bgmAudioInput.current?.click()}
              disabled={bgmUploading}
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-deep px-3.5 py-1.5 text-sm font-bold text-paper shadow-sm transition hover:-translate-y-0.5"
            >
              <UploadSimple weight="bold" className="size-4" />
              {bgmUploading ? "上传中…" : "上传一首我们的歌"}
            </button>
          )}
          <input
            ref={bgmAudioInput}
            type="file"
            accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg"
            className="hidden"
            onChange={(e) => {
              void pickBgm(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        <div className="mt-3.5">
          <label className={labelCls} htmlFor="set-bgm-title">
            歌名（唱片下方和歌词卡上显示）
          </label>
          <input
            id="set-bgm-title"
            value={bgmTitle}
            onChange={(e) => setBgmTitle(e.target.value)}
            className={fieldCls}
            placeholder="我们的歌 - 某位歌手"
            maxLength={120}
          />
        </div>

        <div className="mt-3.5">
          <div className="mb-1.5 flex items-center justify-between">
            <label className={`${labelCls} mb-0`} htmlFor="set-bgm-lyrics">
              歌词（带时间标签可逐行跟唱）
            </label>
            <button
              type="button"
              onClick={() => bgmLrcInput.current?.click()}
              className="text-xs font-bold text-rose-deep underline-offset-2 hover:underline"
            >
              选 .lrc 文件
            </button>
          </div>
          <textarea
            id="set-bgm-lyrics"
            value={bgmLyrics}
            onChange={(e) => setBgmLyrics(e.target.value.slice(0, 20000))}
            rows={5}
            className={`${fieldCls} resize-y font-mono text-xs leading-relaxed`}
            placeholder={"[00:12.50]第一句歌词\n[00:16.20]第二句歌词\n（也可以直接贴纯文字歌词，就像写在信纸上）"}
          />
          <p className="mt-1.5 text-xs text-ink-soft">
            播放大事记里的视频时音乐会自动让路，视频结束后从原进度接上
          </p>
          <input
            ref={bgmLrcInput}
            type="file"
            accept=".lrc,text/plain"
            className="hidden"
            onChange={(e) => {
              void pickLrc(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </fieldset>

      {error && <p className="rounded-xl bg-rose-soft px-4 py-3 text-sm font-bold text-rose-deep">{error}</p>}

      <button type="submit" disabled={state === "saving"} className="btn-primary">
        {state === "saved" ? (
          <>
            <Check weight="bold" className="size-5" />
            已保存
          </>
        ) : (
          <>
            <FloppyDisk weight="bold" className="size-5" />
            {state === "saving" ? "保存中…" : "保存"}
          </>
        )}
      </button>
    </form>
  );
}
