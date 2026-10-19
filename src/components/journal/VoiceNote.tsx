"use client";

import { useEffect, useRef, useState } from "react";
import { SpeakerHigh } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

/** 全站同一时刻只播一条语音：点新的，旧的自动停 */
let currentAudio: HTMLAudioElement | null = null;

function fmtSecs(s: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, "0")}`;
  }
  return `${Math.round(s)}″`;
}

/** 语音便利贴上的播放气泡（微信样式）：点一下播放，声波跳动，
 *  再点一下暂停；同时只有一条在响。
 *  duration 优先用录音时记下的秒数，没有就从元数据里现读
 *  （MediaRecorder 出的 webm 时长常是 Infinity，用跳到末尾的老办法补）。
 *  src 会变的场景（重录/换文件）请用 key 让它重新挂载 */
export function VoiceNote({
  src,
  duration,
  className,
  onLoadedDuration,
}: {
  src: string;
  duration?: number | null;
  className?: string;
  /** 元数据里读出时长时回调（服务端没存的场景，播过一次就有值了） */
  onLoadedDuration?: (seconds: number) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [secs, setSecs] = useState<number | null>(duration && duration > 0 ? duration : null);
  const [elapsed, setElapsed] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function ensureAudio(): HTMLAudioElement {
    if (audioRef.current) return audioRef.current;
    const a = new Audio();
    a.preload = "auto";
    a.src = src;
    a.addEventListener("play", () => setPlaying(true));
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("ended", () => {
      setPlaying(false);
      setElapsed(0);
    });
    a.addEventListener("timeupdate", () => {
      setElapsed(a.currentTime);
      if (Number.isFinite(a.duration) && a.duration > 0) setSecs((prev) => prev ?? a.duration);
    });
    a.addEventListener("error", () => setPlaying(false));
    a.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(a.duration) && a.duration > 0) {
        setSecs((prev) => prev ?? a.duration);
        onLoadedDuration?.(a.duration);
        return;
      }
      // 时长未知（录音 webm 的通病）：跳到很远的时刻骗浏览器算出总长，再回到开头
      const onSeeked = () => {
        a.removeEventListener("seeked", onSeeked);
        if (Number.isFinite(a.duration) && a.duration > 0) {
          setSecs((prev) => prev ?? a.duration);
          onLoadedDuration?.(a.duration);
        }
        a.currentTime = 0;
      };
      a.addEventListener("seeked", onSeeked);
      a.currentTime = 1e7;
    });
    audioRef.current = a;
    return a;
  }

  function toggle() {
    const a = ensureAudio();
    if (playing) {
      a.pause();
      return;
    }
    if (currentAudio && currentAudio !== a) currentAudio.pause();
    currentAudio = a;
    void a.play().catch(() => setPlaying(false));
  }

  useEffect(() => {
    const a = audioRef.current;
    return () => {
      if (currentAudio === a) currentAudio = null;
      a?.pause();
    };
  }, []);

  const label = playing ? (secs ? `${fmtSecs(elapsed)} / ${fmtSecs(secs)}` : fmtSecs(elapsed)) : secs ? fmtSecs(secs) : "";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "暂停语音" : "播放语音"}
        className={cn(
          "inline-flex items-center gap-2.5 rounded-full bg-rose-deep py-2 pl-3.5 pr-4 text-paper shadow-sm transition-all duration-300 ease-spring",
          "hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-95"
        )}
      >
        <SpeakerHigh weight={playing ? "fill" : "bold"} className="size-4.5 shrink-0" />
        <span className="voice-wave" data-playing={playing} aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </span>
      </button>
      {label && <span className="font-round text-xs font-bold tracking-wider text-ink/60">{label}</span>}
    </div>
  );
}
