import { NextResponse } from "next/server";
import {
  isQuickAccepted,
  quickCapture,
  type QuickFile,
  type QuickStoredFile,
} from "@/lib/quickCapture";
import {
  QUICK_MULTIPART_MAX_BYTES,
  QUICK_MAX_FILES,
  QuickInputError,
} from "@/lib/quick-files";
import { quickTokenEnabled, quickTokenMatches } from "@/lib/quickToken";
import { extFor, normalizeMime } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES = ["quote", "journal", "photo"] as const;
const MAX_TEXT = 20_000;
const MULTIPART_TOO_BIG = `单个请求带附件不能超过 ${Math.round(
  QUICK_MULTIPART_MAX_BYTES / 1024 / 1024
)}MB；大视频请先用 POST /api/quick/prepare 拿直传地址分步上传（见 docs/iphone-shortcuts.md）`;

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v : "";
}

/** 录音在表单里的字段名（快捷指令配置里用的是 `audio`），用于类型兜底 */
const AUDIO_KEYS = /^(audio|voice|recording)$/i;
const HEIC_BRANDS = ["heic", "heix", "heim", "heis", "mif1", "msf1"];

/** 文件头魔数 → mime。只在表单没给出可信类型时才用，
 *  覆盖 iOS 录音的各种容器（m4a / wav / mp3 / aac / ogg / flac）和常见图片。 */
function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  const ascii = (text: string, offset = 0) => buf.subarray(offset, offset + text.length).toString("latin1") === text;
  const hex = (bytes: string) => buf.subarray(0, bytes.length / 2).equals(Buffer.from(bytes, "hex"));
  if (ascii("ftyp", 4)) {
    const brand = buf.subarray(8, 12).toString("latin1").trim();
    if (HEIC_BRANDS.includes(brand)) return "image/heic";
    if (/^m4[abp]$/i.test(brand)) return "audio/mp4";
    return brand === "qt" ? "video/quicktime" : "video/mp4";
  }
  if (ascii("RIFF", 0) && ascii("WAVE", 8)) return "audio/wav";
  if (ascii("RIFF", 0) && ascii("WEBP", 8)) return "image/webp";
  if (ascii("OggS", 0)) return "audio/ogg";
  if (ascii("fLaC", 0)) return "audio/flac";
  if (ascii("ID3", 0)) return "audio/mpeg";
  if (hex("ffd8ff")) return "image/jpeg";
  if (hex("89504e470d0a1a0a")) return "image/png";
  if (ascii("GIF8", 0)) return "image/gif";
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg"; // MP3 / AAC ADTS 帧同步
  return null;
}

/** iOS 快捷指令发来的表单经常不带文件名（FormData 默认叫 `blob`），
 *  Content-Type 也可能是 application/octet-stream。这里按
 *  「声明的类型 → 文件头魔数 → 字段名」补齐真实类型和扩展名——
 *  否则录音会被当成 .jpg 存成照片，语录墙上只剩一个裂图。 */
function identifyFormFile(
  key: string,
  rawName: string,
  rawMime: string,
  buf: Buffer,
  index: number
): { name: string; mime: string } {
  const usableName = rawName && !/^(file|blob)$/i.test(rawName) ? rawName : "";
  const declared = normalizeMime(rawMime, usableName);
  if (usableName && /\.[^./\\]+$/.test(usableName) && isQuickAccepted(usableName, declared)) {
    return { name: usableName, mime: declared };
  }
  const mime = sniffMime(buf) ?? (AUDIO_KEYS.test(key) ? "audio/mp4" : declared);
  const base = usableName.replace(/\.[^./\\]+$/, "") || `capture_${index}`;
  return { name: `${base}${extFor(mime, usableName)}`, mime };
}

export async function POST(req: Request) {
  if (!quickTokenEnabled()) {
    return NextResponse.json({ error: "服务器没有配置 SHORTCUT_TOKEN，速记通道未开启" }, { status: 503 });
  }
  if (!quickTokenMatches(req)) {
    return NextResponse.json({ error: "口令不对" }, { status: 401 });
  }
  const contentLength = Number(req.headers.get("content-length"));
  const ct = req.headers.get("content-type") ?? "";

  let type = "quote";
  let text = "";
  let speaker: string | undefined;
  let title: string | undefined;
  let date: string | undefined;
  const files: QuickFile[] = [];
  const stored: QuickStoredFile[] = [];

  if (ct.includes("multipart/form-data")) {
    // multipart 要整包读进内存，先用 Content-Length 把超大请求挡在门外，
    // 免得几百 MB 的视频把小服务器的内存和 CPU 打趴
    if (contentLength > QUICK_MULTIPART_MAX_BYTES) {
      return NextResponse.json({ error: MULTIPART_TOO_BIG }, { status: 413 });
    }
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "表单解析失败" }, { status: 400 });
    type = str(form.get("type")) || "quote";
    text = str(form.get("text")) || str(form.get("body"));
    speaker = str(form.get("speaker")) || undefined;
    title = str(form.get("title")) || undefined;
    date = str(form.get("date")) || undefined;
    let totalBytes = 0;
    for (const [key, v] of form.entries()) {
      if (!(v instanceof File) || v.size === 0) continue;
      totalBytes += v.size;
      if (totalBytes > QUICK_MULTIPART_MAX_BYTES) {
        return NextResponse.json({ error: MULTIPART_TOO_BIG }, { status: 413 });
      }
      if (files.length >= QUICK_MAX_FILES) {
        return NextResponse.json({ error: `一次最多接收 ${QUICK_MAX_FILES} 个文件，实况照片请同名配对` }, { status: 400 });
      }
      const buf = Buffer.from(await v.arrayBuffer());
      const { name, mime } = identifyFormFile(key, v.name, v.type, buf, files.length);
      if (!isQuickAccepted(name, mime)) {
        return NextResponse.json({ error: `「${name}」不是支持的照片/视频/录音/livp/ZIP 格式` }, { status: 415 });
      }
      files.push({ name, mime, buf });
    }
  } else {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "请求体不是 JSON" }, { status: 400 });
    type = typeof body.type === "string" ? body.type : "quote";
    text = typeof body.text === "string" ? body.text : typeof body.body === "string" ? body.body : "";
    speaker = typeof body.speaker === "string" ? body.speaker : undefined;
    title = typeof body.title === "string" ? body.title : undefined;
    date = typeof body.date === "string" ? body.date : undefined;
    // 三步直传的第三步：media[] 里是 /api/quick/prepare 发下去、已经传到位的文件
    if (Array.isArray(body.media)) {
      for (const raw of body.media) {
        const m = raw as Record<string, unknown>;
        const key = typeof m.key === "string" ? m.key.trim() : "";
        const name = typeof m.name === "string" ? m.name.trim() : "";
        const mime = typeof m.mime === "string" ? m.mime.trim() : "";
        if (!key || !name || !mime) {
          return NextResponse.json({ error: "media 里每一项都要有 key / name / mime" }, { status: 400 });
        }
        stored.push({
          key,
          name,
          mime,
          bytes: typeof m.bytes === "number" ? m.bytes : undefined,
        });
        if (stored.length > QUICK_MAX_FILES) {
          return NextResponse.json({ error: `一次最多登记 ${QUICK_MAX_FILES} 个文件` }, { status: 400 });
        }
      }
    }
  }

  if (!(VALID_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: `只支持这几种速记：${VALID_TYPES.join(" / ")}` }, { status: 400 });
  }
  if (files.length > QUICK_MAX_FILES) {
    return NextResponse.json({ error: `一次最多传 ${QUICK_MAX_FILES} 个文件` }, { status: 400 });
  }
  text = text.trim().slice(0, MAX_TEXT);
  if (!text && files.length === 0 && stored.length === 0) {
    return NextResponse.json({ error: "没有内容可记" }, { status: 400 });
  }
  if (type === "photo" && files.length === 0 && stored.length === 0) {
    return NextResponse.json({ error: "存相册至少需要一张照片或一个视频" }, { status: 400 });
  }

  try {
    const entry = await quickCapture({
      type: type as "quote" | "journal" | "photo",
      text,
      speaker,
      title,
      date,
      files,
      stored,
    });
    return NextResponse.json({
      ok: true,
      id: entry.id,
      type: entry.type,
      date: entry.entry_date,
      mediaCount: entry.media.length,
      path: entry.type === "quote" ? "/quotes" : entry.type === "photo" ? "/album" : "/journal",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败了" },
      { status: e instanceof QuickInputError ? e.status : 500 },
    );
  }
}
