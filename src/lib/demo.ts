import { statSync } from "node:fs";
import path from "node:path";

/**
 * 演示模式（公开演示站用）：在 .env.local 里设 NEXT_PUBLIC_DEMO_MODE=1 启用。
 *
 *  - 数据库整个跑在内存里：启动时把种好的 data/journal.db 全量拷进来，
 *    之后每 DEMO_RESET_MINUTES 分钟重置回种子状态——任何保存都只活到下一次重置，
 *    磁盘上的 data/journal.db 永远只读，谁也改不了真的数据；
 *  - 上传的文件体一律丢弃，入库时换成 scripts/seed-assets 里的样例素材
 *    （照片 / 视频 / 实况配对 / 语音 / GIF 表情包），seed 会把它们拷进 data/media；
 *  - 删除媒体不碰磁盘文件，样例素材不会被演示站的删除操作抹掉。
 *
 * 普通部署不设这个变量，一切照旧。
 */

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
export const DEMO_RESET_MINUTES = Math.max(1, Number(process.env.DEMO_RESET_MINUTES) || 5);

const MEDIA_DIR = path.join(process.cwd(), "data", "media");

export type DemoSample = {
  /** data/media 里的文件名（seed 负责放进去） */
  filename: string;
  mime: string;
  width: number;
  height: number;
  /** 音视频时长（秒） */
  duration?: number;
};

const PHOTO_SAMPLES: DemoSample[] = [
  { filename: "demo-photo-1.jpg", mime: "image/jpeg", width: 900, height: 1200 },
  { filename: "demo-photo-2.jpg", mime: "image/jpeg", width: 1200, height: 900 },
  { filename: "demo-photo-3.jpg", mime: "image/jpeg", width: 1000, height: 1000 },
];

const VIDEO_SAMPLE: DemoSample = {
  filename: "demo-video.mp4",
  mime: "video/mp4",
  width: 640,
  height: 360,
  duration: 3,
};

const AUDIO_SAMPLE: DemoSample = {
  filename: "demo-audio.m4a",
  mime: "audio/mp4",
  width: 0,
  height: 0,
  duration: 2,
};

/** 评论里的 GIF 表情包：换成会动的样例 GIF（换静态图会丢「表情包会动」这个体验） */
const GIF_SAMPLE: DemoSample = {
  filename: "demo-emoji.gif",
  mime: "image/gif",
  width: 120,
  height: 120,
};

/** 按上传的原始类型挑样例：演示站上传什么都会「变成」这张/这段 */
export function demoSampleFor(kind: string, mime: string): DemoSample {
  if (mime === "image/gif") return GIF_SAMPLE;
  if (kind === "video" || mime.startsWith("video/")) return VIDEO_SAMPLE;
  if (kind === "audio" || mime.startsWith("audio/")) return AUDIO_SAMPLE;
  return PHOTO_SAMPLES[Math.floor(Math.random() * PHOTO_SAMPLES.length)];
}

const sampleBytesCache = new Map<string, number>();

/** 样例文件大小（stat 一次就缓存；文件由 seed 放好，运行期不会变） */
export function demoSampleBytes(sample: DemoSample): number {
  let bytes = sampleBytesCache.get(sample.filename);
  if (bytes === undefined) {
    try {
      bytes = statSync(path.join(MEDIA_DIR, sample.filename)).size;
    } catch {
      bytes = 1024; // seed 没跑或文件缺了：给个无害的占位数，演示不至于报错
    }
    sampleBytesCache.set(sample.filename, bytes);
  }
  return bytes;
}
