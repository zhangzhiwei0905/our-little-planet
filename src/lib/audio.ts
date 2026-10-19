"use client";

/** 浏览器录音相关的小工具（只在客户端用） */

/** 挑一个 MediaRecorder 能用的音频格式。
 *  优先 audio/mp4（Safari / 新 Chrome 都行，iPhone 上必能放），
 *  再退到 webm;opus（Chrome / Firefox，桌面内自洽）。 */
export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* 忽略，试下一个 */
    }
  }
  return "";
}

const AUDIO_EXT: Record<string, string> = {
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
};

/** 音频 mime（可能带 ;codecs 后缀）对应的扩展名，认不出给 .m4a 兜底 */
export function extOfAudioMime(rawMime: string): string {
  const mime = rawMime.split(";")[0].trim().toLowerCase();
  return AUDIO_EXT[mime] ?? ".m4a";
}

/** 读音频时长（秒）。MediaRecorder 录出的文件元数据里时长常是 Infinity，
 *  用「跳到很远的时刻再读」的老办法补；读不出返回 null。 */
export function probeAudioDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    let settled = false;
    const done = (v: number | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) {
        done(a.duration);
        return;
      }
      a.onseeked = () => {
        done(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null);
      };
      a.currentTime = 1e7;
    };
    a.onerror = () => done(null);
    window.setTimeout(() => done(null), 8000);
    a.src = url;
  });
}
