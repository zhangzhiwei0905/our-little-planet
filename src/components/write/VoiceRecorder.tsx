"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, FileAudio, Microphone, Stop, TrashSimple } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/Toast";
import { VoiceNote } from "@/components/journal/VoiceNote";
import { extOfAudioMime, pickRecorderMime, probeAudioDuration } from "@/lib/audio";
import type { MediaDTO } from "@/lib/client-upload";

/** 一条语音草稿：新录的（file）或已有条目上的（existing） */
export type VoiceDraft = {
  key: string;
  file?: File;
  existing?: MediaDTO;
  url: string;
  duration: number | null;
};

const MAX_SECONDS = 300; // 最多录 5 分钟，到了自动收尾

function fmtClock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** 语录的语音备忘录：现场录音 / 导入音频文件，微信样式的气泡预览 */
export function VoiceRecorder({
  value,
  onChange,
  disabled,
}: {
  value: VoiceDraft | null;
  onChange: (v: VoiceDraft | null) => void;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const keepRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // 计时器 / onstop 闭包里要拿到最新秒数
  const secsRef = useRef(0);
  // onChange 只在事件里调用，存最新引用避免闭包过期
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    return () => {
      // 离开页面 / 组件卸载时把录音现场收拾干净
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    };
  }, []);

  async function start() {
    setError("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("这个浏览器录不了音（需要 Safari / Chrome，且用 https 或 localhost 打开），可以先选一个音频文件");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickRecorderMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      keepRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current !== null) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        const seconds = secsRef.current;
        setRecording(false);
        if (!keepRef.current) return; // 取消：直接丢弃
        if (seconds < 1 || chunksRef.current.length === 0) {
          setError("太短啦，什么都没录到");
          return;
        }
        const cleanMime = (rec.mimeType || "audio/mp4").split(";")[0];
        const blob = new Blob(chunksRef.current, { type: cleanMime });
        const ext = extOfAudioMime(cleanMime);
        const name = `语音-${new Date().toISOString().slice(0, 10)}${ext}`;
        changeRef.current({
          key: `voice-${Date.now()}`,
          file: new File([blob], name, { type: cleanMime }),
          url: URL.createObjectURL(blob),
          duration: seconds,
        });
      };
      rec.start(250);
      recRef.current = rec;
      setSecs(0);
      secsRef.current = 0;
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        const next = secsRef.current + 1;
        secsRef.current = next;
        setSecs(next);
        if (next >= MAX_SECONDS) {
          toast(`一段最多录 ${MAX_SECONDS / 60} 分钟，先到这里啦`);
          stop(true);
        }
      }, 1000);
    } catch {
      setError("拿不到麦克风：看看浏览器的麦克风权限给了没，或者直接选一个音频文件");
    }
  }

  function stop(keep: boolean) {
    keepRef.current = keep;
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    else {
      // 没在录（比如自动收尾的边界情况），只清状态
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setRecording(false);
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    }
  }

  async function importFile(list: FileList | null) {
    const f = list?.[0];
    if (fileInput.current) fileInput.current.value = "";
    if (!f) return;
    if (!f.type.startsWith("audio/") && !/\.(m4a|mp3|aac|wav|webm|ogg|flac)$/i.test(f.name)) {
      setError("只收音频文件（m4a / mp3 / wav…）");
      return;
    }
    if (f.size > 100 * 1024 * 1024) {
      setError("这个音频太大了（超过 100MB）");
      return;
    }
    setError("");
    const url = URL.createObjectURL(f);
    const duration = await probeAudioDuration(url);
    changeRef.current({ key: `voice-${Date.now()}`, file: f, url, duration });
  }

  function remove() {
    changeRef.current(null);
  }

  async function reRecord() {
    remove();
    await start();
  }

  if (recording) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-rose/40 bg-rose-soft/40 px-4 py-3">
        <span className="flex items-center gap-2 font-round text-sm font-bold tabular-nums tracking-wider text-rose-deep">
          <span className="size-2.5 animate-pulse rounded-full bg-rose-deep" />
          录音中 {fmtClock(secs)}
        </span>
        <span className="voice-wave text-rose-deep" data-playing="true" aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => stop(true)}
          className="flex items-center gap-1.5 rounded-full bg-rose-deep px-3.5 py-1.5 text-sm font-bold text-paper transition hover:opacity-90 active:scale-95"
        >
          <Stop weight="fill" className="size-4" />
          录好了
        </button>
        <button
          type="button"
          onClick={() => stop(false)}
          className="rounded-full border border-ink/20 px-3.5 py-1.5 text-sm font-bold text-ink-soft transition hover:bg-ink/5 active:scale-95"
        >
          取消
        </button>
      </div>
    );
  }

  if (value) {
    return (
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <VoiceNote key={value.key} src={value.url} duration={value.duration} />
          {value.existing && (
            <span className="font-round text-xs tracking-wider text-ink-soft/70">已存的一段</span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            disabled={disabled}
            onClick={() => void reRecord()}
            className="flex items-center gap-1 rounded-full border border-ink/15 px-3 py-1.5 text-xs font-bold text-ink-soft transition hover:bg-ink/5 hover:text-ink active:scale-95 disabled:opacity-50"
          >
            <ArrowsClockwise className="size-3.5" />
            重录
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={remove}
            className="flex items-center gap-1 rounded-full border border-ink/15 px-3 py-1.5 text-xs font-bold text-ink-soft transition hover:bg-rose-soft hover:text-rose-deep active:scale-95 disabled:opacity-50"
          >
            <TrashSimple className="size-3.5" />
            删掉
          </button>
        </div>
        {error && <p className="text-xs font-bold text-rose-deep">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void start()}
          className={cn(
            "flex items-center gap-2 rounded-2xl border-2 border-dashed border-ink/20 px-4 py-3 text-sm font-bold text-ink-soft transition",
            "hover:border-rose hover:bg-rose-soft/30 hover:text-ink disabled:opacity-50"
          )}
        >
          <Microphone weight="bold" className="size-5 text-rose-deep" />
          录一段语音
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
          className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-ink/20 px-4 py-3 text-sm font-bold text-ink-soft transition hover:border-rose hover:bg-rose-soft/30 hover:text-ink disabled:opacity-50"
        >
          <FileAudio weight="bold" className="size-5 text-rose-deep" />
          选音频文件
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.m4a,.mp3,.wav,.aac,.ogg,.webm,.flac"
          hidden
          onChange={(e) => void importFile(e.target.files)}
        />
      </div>
      <p className="mt-2 px-1 text-xs leading-relaxed text-ink-soft/80">
        可以只录语音、只写文字，或者两个都来（比如「一周年我想对她说的话」）；一段最多 5 分钟。
      </p>
      {error && <p className="mt-1.5 px-1 text-xs font-bold text-rose-deep">{error}</p>}
    </div>
  );
}
