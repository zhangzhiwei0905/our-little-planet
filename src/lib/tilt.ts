/** 从字符串稳定地算一个哈希，用于决定倾斜角度、胶带颜色等，
 *  保证服务端和客户端渲染一致（避免 hydration 抖动），同一张卡片每次看都一样 */
export function hashCode(s: string): number {
  let h = 0;
  for (const c of s) {
    h = (h * 31 + c.charCodeAt(0)) | 0;
  }
  return Math.abs(h);
}

/** 拍立得/便利贴的随手一贴角度：-span..span 度 */
export function tiltOf(id: string, span = 3): number {
  return (hashCode(id) % (span * 2 + 1)) - span;
}

/** 从一组候选项里按 id 稳定挑一个（贴纸色、胶带色） */
export function pickOf<T>(id: string, arr: readonly T[]): T {
  return arr[hashCode(id) % arr.length];
}

export const TAPE_TONES = ["rose", "butter", "mist", "peach", "matcha"] as const;
export type TapeTone = (typeof TAPE_TONES)[number];

export const TAPE_COLORS: Record<TapeTone, string> = {
  rose: "#e48ba8",
  butter: "#f7e3a1",
  mist: "#a8c5d6",
  peach: "#f5c6a5",
  matcha: "#b8d4b8",
};

export const NOTE_TONES = ["butter", "peach", "mist", "rose-soft", "matcha"] as const;
export type NoteTone = (typeof NOTE_TONES)[number];

export const NOTE_COLORS: Record<NoteTone, string> = {
  butter: "#f7e3a1",
  peach: "#f5c6a5",
  mist: "#cfe2ec",
  "rose-soft": "#f9dfe8",
  matcha: "#d5e8d5",
};
