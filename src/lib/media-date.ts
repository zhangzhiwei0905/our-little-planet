/** 读取文件的真实拍摄日期（YYYY-MM-DD，本地时区），用于上传时自动设置手账日期。
 *  优先级：JPEG 的 EXIF DateTimeOriginal → 视频 mvhd 创建时间 → 文件修改时间（兜底）。
 *  AirDrop / 相册导出会保留拍摄时间，所以「iPhone 选图 → AirDrop 到 Mac → 上传」整条链是准的 */

function toLocalDate(ms: number): string | null {
  if (!(ms > 946684800000) || ms > 4102444800000) return null; // 2001..2100 之外认为不可信
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** EXIF 里 "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DD" */
function exifStringToDate(s: string): string | null {
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T]/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/** JPEG 头部（前 256KB 足够）里解析 EXIF DateTimeOriginal */
function jpegExifDate(b: Uint8Array): string | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 4 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1];
    if (marker === 0xda) return null; // 到图像数据了，没碰到 EXIF
    if (marker < 0xe0 || marker === 0x01) {
      o += 2;
      continue;
    }
    const len = (b[o + 2] << 8) | b[o + 3];
    if (marker === 0xe1 && len > 14 && b[o + 4] === 0x45 && b[o + 5] === 0x78 && b[o + 6] === 0x69 && b[o + 7] === 0x66 && b[o + 8] === 0 && b[o + 9] === 0) {
      // APP1 "Exif\0\0"
      return parseTiffExif(b.subarray(o + 10, o + 2 + len));
    }
    o += 2 + len;
  }
  return null;
}

function parseTiffExif(tiff: Uint8Array): string | null {
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null;
  const u16 = (p: number) => (le ? tiff[p] | (tiff[p + 1] << 8) : (tiff[p] << 8) | tiff[p + 1]);
  const u32 = (p: number) =>
    le
      ? ((tiff[p] | (tiff[p + 1] << 8) | (tiff[p + 2] << 16) | (tiff[p + 3] << 24)) >>> 0)
      : (((tiff[p] << 24) | (tiff[p + 1] << 16) | (tiff[p + 2] << 8) | tiff[p + 3]) >>> 0);

  const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8];
  /** 找 tag，把值当 ASCII 读出来（日期字段都是 ASCII） */
  const asciiTag = (ifdOff: number, tag: number): string | null => {
    if (ifdOff + 2 > tiff.length) return null;
    const n = u16(ifdOff);
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      if (e + 12 > tiff.length) return null;
      if (u16(e) !== tag) continue;
      const type = Math.min(u16(e + 2), 10);
      const count = u32(e + 4);
      const size = count * (TYPE_SIZE[type] ?? 4);
      const valOff = size <= 4 ? e + 8 : u32(e + 8);
      if (valOff + count > tiff.length) return null;
      let s = "";
      for (let k = 0; k < count && tiff[valOff + k] !== 0; k++) s += String.fromCharCode(tiff[valOff + k]);
      return s;
    }
    return null;
  };
  /** 找 LONG 型 tag 的数值（用于 Exif 子 IFD 偏移） */
  const longTag = (ifdOff: number, tag: number): number | null => {
    if (ifdOff + 2 > tiff.length) return null;
    const n = u16(ifdOff);
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      if (e + 12 > tiff.length) return null;
      if (u16(e) === tag && u16(e + 2) === 4) return u32(e + 8);
    }
    return null;
  };

  const ifd0 = u32(4);
  const exifSub = longTag(ifd0, 0x8769); // ExifIFD 指针（TIFF 内偏移，相对 TIFF 头）
  const raw =
    (exifSub !== null ? asciiTag(exifSub, 0x9003) : null) ?? // DateTimeOriginal(拍摄时间)
    asciiTag(ifd0, 0x9003) ??
    asciiTag(ifd0, 0x0132); // 退化用 DateTime(修改时间)
  return raw ? exifStringToDate(raw) : null;
}

/** 在视频字节里找 mvhd 盒，读创建时间（QuickTime 纪元 1904-01-01 UTC） */
function movDateFrom(b: Uint8Array): string | null {
  const needle = [0x6d, 0x76, 0x68, 0x64]; // "mvhd"
  for (let i = 0; i + 16 <= b.length; i++) {
    if (b[i] !== needle[0] || b[i + 1] !== needle[1] || b[i + 2] !== needle[2] || b[i + 3] !== needle[3]) continue;
    const version = b[i + 4];
    let seconds = 0;
    try {
      if (version === 1 && i + 20 <= b.length) {
        seconds = Number(new DataView(b.buffer, b.byteOffset + i + 8, 8).getBigUint64(0));
      } else if (i + 12 <= b.length) {
        seconds = new DataView(b.buffer, b.byteOffset + i + 8, 4).getUint32(0);
      }
    } catch {
      return null;
    }
    const d = toLocalDate((seconds - 2082844800) * 1000);
    if (d) return d;
  }
  return null;
}

/** 文件名里带的拍摄日期：手机导出常见命名，如「2026-08-19 235022.livp」「2026.08.19.jpg」
 *  「IMG_20260819_235022.jpg」。比文件修改时间可靠（微信另存/打包导出会把 mtime 改成导出时间） */
function filenameDate(name: string): string | null {
  const m = name.match(/(?:^|[^\d])(\d{4})[-_. ](\d{1,2})[-_. ](\d{1,2})(?!\d)(?:[ _T]*(\d{2})(\d{2})(\d{2})?)?/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 拿文件的真实拍摄日期；拿不到返回 null */
export async function readTakenAt(file: File): Promise<string | null> {
  try {
    const isJpeg = file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
    const isVideo = file.type.startsWith("video/") || /\.(mov|mp4|m4v)$/i.test(file.name);
    if (isJpeg) {
      const head = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
      const d = jpegExifDate(head);
      if (d) return d;
    } else if (isVideo) {
      const head = new Uint8Array(await file.slice(0, 1_000_000).arrayBuffer());
      let d = movDateFrom(head);
      if (!d && file.size > 1_500_000) {
        const tail = new Uint8Array(await file.slice(Math.max(1_000_000, file.size - 12_000_000)).arrayBuffer());
        d = movDateFrom(tail);
      }
      if (d) return d;
    }
    // 文件名里的日期（导出命名）比修改时间可靠：微信另存 / 压缩包解出来 mtime 全是导出那一刻
    const fd = filenameDate(file.name);
    if (fd) return fd;
    // 兜底：文件修改时间（AirDrop / 相册导出会设成拍摄时间；微信另存之类的会不准，用户可手改）
    if (file.lastModified > 0) {
      const d = toLocalDate(file.lastModified);
      if (d) return d;
    }
  } catch {
    /* 拿不到就算了 */
  }
  return null;
}
