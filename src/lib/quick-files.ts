import { unzipSync } from "fflate";

export type QuickFile = { name: string; mime: string; buf: Buffer };
export type QuickMedia = { file: QuickFile; liveVideo?: QuickFile };

export const QUICK_MAX_BYTES = 500 * 1024 * 1024;
/** multipart 表单一次能带的附件总量上限：表单要整包读进内存，大了会把小服务器打趴
 *  （CPU / 内存暴涨）。大文件走 /api/quick/prepare 的直传三步，不经这个限制。 */
export const QUICK_MULTIPART_MAX_BYTES = 150 * 1024 * 1024;
export const QUICK_MAX_MEDIA = 9;
export const QUICK_MAX_FILES = QUICK_MAX_MEDIA * 2;

export class QuickInputError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "QuickInputError";
  }
}

const ARCHIVE_MIME: Record<string, string> = {
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
};

function extension(name: string): string {
  return (name.match(/\.[^./\\]+$/)?.[0] ?? "").toLowerCase();
}

function isArchiveMetadata(name: string): boolean {
  return name.endsWith("/") || name.split(/[\\/]/).some((part) => part.startsWith(".") || part === "__MACOSX");
}

function readArchive(file: QuickFile, maxBytes = QUICK_MAX_BYTES, maxFiles = QUICK_MAX_FILES): QuickFile[] {
  let count = 0;
  let bytes = 0;
  try {
    // Inspect declared sizes before fflate allocates decompression buffers.
    const entries = unzipSync(new Uint8Array(file.buf.buffer, file.buf.byteOffset, file.buf.byteLength), {
      filter(member) {
        if (isArchiveMetadata(member.name)) return false;
        if (!ARCHIVE_MIME[extension(member.name)]) {
          if (/\.livp$/i.test(file.name)) return false;
          throw new QuickInputError(`「${file.name}」里有不支持的文件「${member.name}」，请只打包照片和视频`, 415);
        }
        count += 1;
        bytes += member.originalSize;
        if (count > maxFiles) {
          throw new QuickInputError(`解包后最多 ${QUICK_MAX_FILES} 个文件（最多 ${QUICK_MAX_MEDIA} 项媒体）`);
        }
        if (member.originalSize === 0) throw new QuickInputError(`「${member.name}」是空文件`);
        if (member.originalSize > QUICK_MAX_BYTES || bytes > maxBytes) {
          throw new QuickInputError("解包后的照片和视频总大小不能超过 500MB", 413);
        }
        return true;
      },
    });
    return Object.entries(entries).map(([name, data]) => ({
      name,
      mime: ARCHIVE_MIME[extension(name)],
      buf: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
    }));
  } catch (error) {
    if (error instanceof QuickInputError) throw error;
    throw new QuickInputError(`「${file.name}」不是有效的 ZIP / livp 文件`);
  }
}

export function expandLivp(name: string, buf: Buffer, maxBytes = QUICK_MAX_BYTES, maxFiles = QUICK_MAX_FILES): QuickFile[] {
  const files = readArchive({ name, mime: "application/zip", buf }, maxBytes, maxFiles);
  const photo = files.find((file) => file.mime.startsWith("image/"));
  const video = files.find((file) => file.mime.startsWith("video/"));
  const base = name.replace(/\.livp$/i, "");
  const result = [photo, video].filter((file): file is QuickFile => Boolean(file)).map((file) => ({
    ...file,
    name: `${base}${extension(file.name) === ".jpeg" ? ".jpg" : extension(file.name)}`,
  }));
  if (result.length === 0) throw new QuickInputError(`「${name}」里没有找到照片或视频`);
  return result;
}

function baseName(name: string): string {
  return name.replace(/\.[^./\\]+$/, "").toLowerCase();
}

export function planQuickMedia(files: QuickFile[]): QuickMedia[] {
  const groups = new Map<string, QuickFile[]>();
  for (const file of files) {
    const base = baseName(file.name);
    const group = groups.get(base) ?? [];
    group.push(file);
    groups.set(base, group);
  }
  const liveVideoOf = new Map<QuickFile, QuickFile>();
  const pairedVideos = new Set<QuickFile>();
  for (const [base, group] of groups) {
    const photos = group.filter((file) => file.mime.startsWith("image/"));
    const videos = group.filter((file) => file.mime.startsWith("video/"));
    if (photos.length === 0 || videos.length === 0) continue;
    if (photos.length !== 1 || videos.length !== 1) {
      throw new QuickInputError(`「${base}」有多张同名照片或视频，请给每一项媒体设置不同名称`);
    }
    liveVideoOf.set(photos[0], videos[0]);
    pairedVideos.add(videos[0]);
  }
  const media = files.filter((file) => !pairedVideos.has(file)).map((file) => ({
    file,
    liveVideo: liveVideoOf.get(file),
  }));
  if (media.length > QUICK_MAX_MEDIA) {
    throw new QuickInputError(`一次最多上传 ${QUICK_MAX_MEDIA} 项媒体，实况照片按一项计算`);
  }
  return media;
}

export function prepareQuickFiles(input: QuickFile[]): QuickMedia[] {
  if (input.length > QUICK_MAX_FILES) {
    throw new QuickInputError(`一次最多接收 ${QUICK_MAX_FILES} 个文件（最多 ${QUICK_MAX_MEDIA} 项媒体）`);
  }
  if (input.reduce((bytes, file) => bytes + file.buf.byteLength, 0) > QUICK_MAX_BYTES) {
    throw new QuickInputError("一次上传的文件总大小不能超过 500MB", 413);
  }
  const files: QuickFile[] = [];
  let bytes = 0;
  for (const file of input) {
    const expanded = /\.livp$/i.test(file.name)
      ? expandLivp(file.name, file.buf, QUICK_MAX_BYTES - bytes, QUICK_MAX_FILES - files.length)
      : /\.zip$/i.test(file.name)
        ? readArchive(file, QUICK_MAX_BYTES - bytes, QUICK_MAX_FILES - files.length)
        : [file];
    if (expanded.length === 0) throw new QuickInputError(`「${file.name}」里没有找到照片或视频`);
    for (const member of expanded) {
      bytes += member.buf.byteLength;
      if (bytes > QUICK_MAX_BYTES) throw new QuickInputError("解包后的文件总大小不能超过 500MB", 413);
      files.push(member);
      if (files.length > QUICK_MAX_FILES) {
        throw new QuickInputError(`解包后最多 ${QUICK_MAX_FILES} 个文件（最多 ${QUICK_MAX_MEDIA} 项媒体）`);
      }
    }
  }
  return planQuickMedia(files);
}
