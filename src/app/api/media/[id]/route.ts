import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMediaById, mediaPath, posterKey, posterName, thumbKey, thumbName, type MediaRow } from "@/lib/media";
import { MEDIA_DIR } from "@/lib/db";
import { isAuthor, isEggUnlocked, isReader } from "@/lib/auth";
import { listEggs } from "@/lib/eggs";
import { sanitizeTags } from "@/lib/tags";
import { upsertTags } from "@/lib/tagStore";
import { ossGetUrl, ossObjectExists, storageMode } from "@/lib/storage";
import { todayLocal } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 彩蛋里的照片对「拆开过这个彩蛋」的访客开放（她凭彩蛋密码进来，不需要手账读者密码）；
 *  覆盖照片本身和它的实况配对视频 */
async function eggUnlockedForMedia(row: MediaRow): Promise<boolean> {
  for (const egg of listEggs()) {
    if (!egg.photoIds.includes(row.id) && !egg.photoIds.some((pid) => getMediaById(pid)?.live_video_id === row.id)) {
      continue;
    }
    if (await isEggUnlocked(egg.id)) return true;
  }
  return false;
}

/** 访客能看到哪些媒体：
 *  1) 挂在「公开」条目上的（含录音）；
 *  2) 被任何公开页引用的——手账页「从本子里选」引用的照片/视频，它自己的归属页
 *     可能还是私密（引用不动 entry_id），但既然作者把引用它的那页公开了，就该给看；
 *  3) Live Photo 的配对视频：它的照片可见它就可见。
 *  三条都不满足的（评论图、贴纸库、背景音乐等孤儿）一律不给看 */
function guestCanSeeMedia(row: MediaRow): boolean {
  const today = todayLocal();
  if (row.entry_id) {
    const entry = db
      .prepare(
        "SELECT visibility FROM entries WHERE id = ? AND published = 1 AND (reveal_at IS NULL OR reveal_at <= ?)"
      )
      .get(row.entry_id, today) as { visibility: string } | undefined;
    if (entry?.visibility === "public") return true;
  }
  // 被公开页引用（ref_media / 自由拼贴 layout），无论它自己挂在哪一页
  const needle = `%"${row.id}"%`;
  const hit = db
    .prepare(
      `SELECT 1 FROM entries
       WHERE visibility = 'public' AND published = 1 AND (reveal_at IS NULL OR reveal_at <= ?)
         AND (ref_media LIKE ? OR layout LIKE ?) LIMIT 1`
    )
    .get(today, needle, needle);
  if (hit) return true;
  // 公开且已首映的放映场次：它的完整视频和封面图对访客可见
  const screenHit = db
    .prepare(
      `SELECT 1 FROM screenings
       WHERE visibility = 'public' AND premiere_at <= ?
         AND (media_id = ? OR cover_media_id = ?) LIMIT 1`
    )
    .get(today, row.id, row.id);
  if (screenHit) return true;
  // Live Photo 配对视频：去问它的照片（照片不会再是别人的配对，递归一层封顶）
  const pairOf = db.prepare("SELECT id FROM media WHERE live_video_id = ? LIMIT 1").get(row.id) as
    | { id: string }
    | undefined;
  if (pairOf) {
    const photo = getMediaById(pairOf.id);
    if (photo && photo.id !== row.id) return guestCanSeeMedia(photo);
  }
  return false;
}

/** 照片/视频都在锁后：未解锁不给看。
 *  彩蛋里的照片除外——凭对应彩蛋的解锁身份也能看。
 *  ?thumb=1 返回照片墙用的 480px WebP 缩略图（没有就回落原图）。
 *  OSS 模式：302 到带签名的临时 URL，浏览器直接从 OSS 拉（省服务器带宽）；
 *  本地模式：直接读文件返回（视频带 Range 支持） */
/** 改照片/视频的描述 / 日期 / 标签（「本子里的一切」按张管理用） */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const row = getMediaById(id);
  if (!row) return NextResponse.json({ error: "这个文件不存在" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as
    | { caption?: unknown; entryDate?: unknown; tags?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: "内容格式不对" }, { status: 400 });

  // 描述
  if (typeof body.caption === "string") {
    db.prepare("UPDATE media SET caption = NULLIF(?, '') WHERE id = ?").run(body.caption.slice(0, 300), id);
  }

  // 标签（每张媒体自己的；空数组存 '[]' 而不是 NULL，避免被「条目级拷贝」迁移回填），顺手进全局标签库
  if (Array.isArray(body.tags)) {
    const clean = sanitizeTags(body.tags);
    db.prepare("UPDATE media SET tags = ? WHERE id = ?").run(JSON.stringify(clean), id);
    upsertTags(clean);
  }

  // 日期：把这张挪到对应日期的照片页（Live 配对的视频跟着一起搬；搬空的旧页自动清掉）
  if (typeof body.entryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.entryDate) && row.kind !== "audio") {
    const oldEntryId = row.entry_id;
    let target = (
      db.prepare("SELECT id FROM entries WHERE type = 'photo' AND entry_date = ? ORDER BY created_at LIMIT 1").get(body.entryDate) as
        | { id: string }
        | undefined
    )?.id;
    if (!target) {
      const now = new Date().toISOString();
      target = `${body.entryDate.replaceAll("-", "")}${Math.random().toString(16).slice(2, 8)}`;
      db.prepare(
        `INSERT INTO entries (id, type, title, body, entry_date, published, created_at, updated_at)
         VALUES (?, 'photo', NULL, '', ?, 1, ?, ?)`
      ).run(target, body.entryDate, now, now);
    }
    if (!oldEntryId || oldEntryId !== target) {
      db.prepare("UPDATE media SET entry_id = ? WHERE id = ?").run(target, id);
      if (row.live_video_id) {
        db.prepare("UPDATE media SET entry_id = ? WHERE id = ? AND (entry_id IS NULL OR entry_id = ?)").run(target, row.live_video_id, oldEntryId);
      }
      if (oldEntryId) {
        const left = (db.prepare("SELECT COUNT(*) AS n FROM media WHERE entry_id = ?").get(oldEntryId) as { n: number }).n;
        const oldType = (db.prepare("SELECT type FROM entries WHERE id = ?").get(oldEntryId) as { type: string } | undefined)?.type;
        if (left === 0 && oldType === "photo") {
          // 照片都搬走了，这页留着也没内容，顺手删掉
          db.prepare("DELETE FROM entries WHERE id = ?").run(oldEntryId);
        }
      }
    }
  }
  return NextResponse.json({ ok: true });
}

/** 删掉一张照片/视频：「本子里的一切」按张删除、表单里放弃未保存的上传都走这里。
 *  连缩略图/视频封面/Live 配对视频一起删；照片都删空的页面顺手回收。
 *  已挂到条目上的必须带 ?force=1（按张删除的界面才带）——这个口子平时只清理
 *  未入册的孤儿上传，别让「放弃编辑」的清理误删已经贴进本子的照片 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthor())) {
    return NextResponse.json({ error: "先输入作者口令" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const row = getMediaById(id);
  if (!row) return NextResponse.json({ ok: true });
  if (row.kind !== "photo" && row.kind !== "video") {
    // 没挂任何条目的音频（背景音乐、表单里放弃的语音草稿）允许直接删；
    // 挂了条目的语音仍去对应条目里删
    if (row.kind !== "audio" || row.entry_id !== null) {
      return NextResponse.json({ error: "语音之类的去对应条目里删" }, { status: 400 });
    }
  }
  if (row.entry_id !== null && new URL(req.url).searchParams.get("force") !== "1") {
    return NextResponse.json({ error: "这张已经贴进本子了，去对应页面里删" }, { status: 400 });
  }
  const { deleteMediaCompletely } = await import("@/lib/media");
  // Live 配对：删照片带着配对视频一起走；删视频就把照片上的引用解绑
  if (row.kind === "photo" && row.live_video_id) {
    const pair = getMediaById(row.live_video_id);
    if (pair) await deleteMediaCompletely(pair).catch(() => undefined);
  }
  if (row.kind === "video") {
    db.prepare("UPDATE media SET live_video_id = NULL WHERE live_video_id = ?").run(id);
  }
  const oldEntryId = row.entry_id;
  await deleteMediaCompletely(row);
  if (oldEntryId) {
    const left = (db.prepare("SELECT COUNT(*) AS n FROM media WHERE entry_id = ?").get(oldEntryId) as { n: number }).n;
    const oldType = (db.prepare("SELECT type FROM entries WHERE id = ?").get(oldEntryId) as { type: string } | undefined)?.type;
    if (left === 0 && oldType === "photo") {
      // 照片都删走了，空页顺手回收
      db.prepare("DELETE FROM entries WHERE id = ?").run(oldEntryId);
    }
  }
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = getMediaById(id);
  if (!row) return new NextResponse("Not Found", { status: 404 });
  if (!(await isReader()) && !(await eggUnlockedForMedia(row)) && !guestCanSeeMedia(row)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // 缩略图：墙上小图专用，还没生成时回落原图（后台补上后自然切换）
  if (new URL(req.url).searchParams.get("thumb") === "1" && row.kind === "photo") {
    if (storageMode() === "oss") {
      if (await ossObjectExists(thumbKey(row.id))) {
        return NextResponse.redirect(ossGetUrl(thumbKey(row.id)), {
          status: 302,
          // no-referrer：跳去 OSS 的请求别带 Referer（桶的防盗链只认白名单和空 Referer），
          // 本地调试或换域名部署都不会被 403 拦裂图
          headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=60", "Referrer-Policy": "no-referrer" },
        });
      }
    } else {
      const tbuf = await readFile(path.join(MEDIA_DIR, thumbName(row.id))).catch(() => null);
      if (tbuf) {
        return new NextResponse(new Uint8Array(tbuf), {
          status: 200,
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "private, max-age=31536000, immutable",
            "Content-Length": String(tbuf.byteLength),
          },
        });
      }
    }
  }

  // 视频封面：ffmpeg 抽的第一帧；还没生成时 404（前端回落 <video> 首帧）
  if (new URL(req.url).searchParams.get("poster") === "1" && row.kind === "video") {
    if (storageMode() === "oss") {
      if (await ossObjectExists(posterKey(row.id))) {
        return NextResponse.redirect(ossGetUrl(posterKey(row.id)), {
          status: 302,
          headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=60", "Referrer-Policy": "no-referrer" },
        });
      }
      return new NextResponse("Not Found", { status: 404 });
    }
    const pbuf = await readFile(path.join(MEDIA_DIR, posterName(row.id))).catch(() => null);
    if (!pbuf) return new NextResponse("Not Found", { status: 404 });
    return new NextResponse(new Uint8Array(pbuf), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": String(pbuf.byteLength),
      },
    });
  }

  if (storageMode() === "oss") {
    // 签名地址有效 1 小时，应用层跳转缓存 5 分钟，避免重复进页面时再次绕一圈。
    return NextResponse.redirect(ossGetUrl(row.filename), {
      status: 302,
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=60", "Referrer-Policy": "no-referrer" },
    });
  }

  const buf = await readFile(mediaPath(row)).catch(() => null);
  if (!buf) return new NextResponse("Not Found", { status: 404 });

  const total = buf.byteLength;
  const range = req.headers.get("range");
  const baseHeaders: Record<string, string> = {
    "Content-Type": row.mime,
    "Cache-Control": "private, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };

  // 视频拖进度条需要 Range 支持
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
    if (start >= total || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }
    const chunk = buf.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(chunk), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(chunk.byteLength),
      },
    });
  }

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(total) },
  });
}
