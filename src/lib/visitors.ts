import { cookies, headers } from "next/headers";
import { db } from "./db";
import { newId, nowISO } from "./ids";
import { AUTHOR_COOKIE, READER_COOKIE } from "./auth";

/** 访客记录：未登录（没有读者/作者 cookie）的人打开过哪些页。
 *  只能识别到 IP 层面——IP 再解析出大概的城市和运营商（查一次公开 GeoIP
 *  接口后落库缓存），拿不到手机号/账号这类精确身份。
 *  爬虫按 User-Agent 识别并打标，统计里默认排除。 */

const BOT_RE = /(bot|crawler|spider|slurp|curl|wget|headless|python-requests|facebookexternalhit|lighthouse|pagespeed|semrush|mj12|ahrefs|yandex|bingpreview|applebot)/i;
const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc00:|fe80:|localhost)/i;

/** 扫描器常用的一种伪装 UA：到 AppleWebKit/x.x 就截然而止，后面没有
 *  Chrome/Safari 版本号——真浏览器不会这样。华为云等机房扫描器就爱用 */
const TRUNCATED_UA_RE = /AppleWebKit\/[\d.]+\s*$/i;

/** 同一 IP 刷新同一页的去重窗口：30 秒内的重复打开不重复计数 */
const DEDUPE_MS = 30_000;

/** 记一次访客打开（各页面顶部调用：仅未登录访客；整页加载和站内软导航都会进页面，
 *  所以放页面里才抓得住「点了导航标签翻页」的轨迹） */
export async function recordGuestVisitFor(path: string): Promise<void> {
  try {
    const h = await headers();
    // 链接预取不算「有人打开」（预取请求带专门的头，页面也会被执行）
    if (h.get("next-router-prefetch") === "1") return;
    const c = await cookies();
    if (c.get(READER_COOKIE)?.value || c.get(AUTHOR_COOKIE)?.value) return;
    const ip =
      h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    recordGuestVisit(ip, path, h.get("user-agent"));
  } catch {
    /* 记录失败不影响页面渲染 */
  }
}

export function looksLikeBot(ua: string | null): boolean {
  return Boolean(ua && (BOT_RE.test(ua) || TRUNCATED_UA_RE.test(ua.trim())));
}

/** 记一次访客打开（根布局里调用：仅未登录访客、仅整页加载） */
export function recordGuestVisit(ip: string, path: string, ua: string | null): void {
  if (!ip || !path.startsWith("/")) return;
  if (path.startsWith("/api") || path.startsWith("/_next")) return;
  const bot = looksLikeBot(ua) ? 1 : 0;
  // 30 秒内同 IP 同页的重复请求（手抖刷新）不重复记
  const since = new Date(Date.now() - DEDUPE_MS).toISOString();
  const dup = db
    .prepare("SELECT 1 FROM guest_visits WHERE ip = ? AND path = ? AND created_at >= ? LIMIT 1")
    .get(ip, path, since);
  if (dup) return;
  db.prepare("INSERT INTO guest_visits (id, ip, path, ua, bot, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    newId(),
    ip,
    path.slice(0, 120),
    ua ? ua.slice(0, 200) : null,
    bot,
    nowISO()
  );
}

/** UA → 设备标签（后台展示用） */
export function deviceOf(ua: string | null): string {
  if (!ua) return "未知设备";
  if (/OpenHarmony|HarmonyOS/i.test(ua)) return "手机·鸿蒙";
  if (/iPhone|iPod/i.test(ua)) return "手机·iPhone";
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return "手机·安卓";
  if (/Android/i.test(ua)) return "平板/安卓";
  if (/iPad|Tablet/i.test(ua)) return "平板";
  if (/Macintosh/i.test(ua)) return "电脑·Mac";
  if (/Windows/i.test(ua)) return "电脑·Windows";
  if (/Linux/i.test(ua)) return "电脑·Linux";
  return "其他设备";
}

export type VisitorRow = {
  ip: string;
  visits: number;
  firstAt: string;
  lastAt: string;
  device: string;
  /** 最近看过的页面（去重，新的在前） */
  paths: string[];
  /** 这个 IP 的记录里爬虫占的比重（>0 说明至少混有爬虫） */
  bots: number;
};

export type VisitLog = { ip: string; path: string; ua: string | null; bot: boolean; createdAt: string; device: string };

export function visitorStats(): {
  uv: number;
  pv: number;
  todayUv: number;
  todayPv: number;
  botPv: number;
  visitors: VisitorRow[];
  recent: VisitLog[];
} {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const total = db
    .prepare("SELECT COUNT(*) pv, COUNT(DISTINCT ip) uv FROM guest_visits WHERE bot = 0")
    .get() as { pv: number; uv: number };
  const today = db
    .prepare("SELECT COUNT(*) pv, COUNT(DISTINCT ip) uv FROM guest_visits WHERE bot = 0 AND created_at >= ?")
    .get(todayIso) as { pv: number; uv: number };
  const bots = (db.prepare("SELECT COUNT(*) n FROM guest_visits WHERE bot = 1").get() as { n: number }).n;

  const byIp = db
    .prepare(
      `SELECT ip, COUNT(*) visits, MIN(created_at) firstAt, MAX(created_at) lastAt, SUM(bot) bots
       FROM guest_visits GROUP BY ip ORDER BY lastAt DESC LIMIT 200`
    )
    .all() as { ip: string; visits: number; firstAt: string; lastAt: string; bots: number }[];
  // 每个 IP 最近看过的页面（从最近的 400 条里归并，够用了）
  const recentRows = db
    .prepare("SELECT ip, path, ua, bot, created_at FROM guest_visits ORDER BY created_at DESC LIMIT 400")
    .all() as { ip: string; path: string; ua: string | null; bot: number; created_at: string }[];
  const pathsByIp = new Map<string, string[]>();
  const uaByIp = new Map<string, string>();
  for (const r of recentRows) {
    const list = pathsByIp.get(r.ip) ?? [];
    if (!list.includes(r.path) && list.length < 5) list.push(r.path);
    pathsByIp.set(r.ip, list);
    if (!uaByIp.has(r.ip)) uaByIp.set(r.ip, r.ua ?? "");
  }

  const visitors: VisitorRow[] = byIp.map((r) => ({
    ip: r.ip,
    visits: r.visits,
    firstAt: r.firstAt,
    lastAt: r.lastAt,
    device: deviceOf(uaByIp.get(r.ip) ?? null),
    paths: pathsByIp.get(r.ip) ?? [],
    bots: r.bots,
  }));

  const recent: VisitLog[] = recentRows.slice(0, 50).map((r) => ({
    ip: r.ip,
    path: r.path,
    ua: r.ua,
    bot: r.bot === 1,
    createdAt: r.created_at,
    device: deviceOf(r.ua),
  }));

  return { uv: total.uv, pv: total.pv, todayUv: today.uv, todayPv: today.pv, botPv: bots, visitors, recent };
}

/* ---- IP → 城市解析（ip-api.com 免费 GeoIP，查过就缓存） ---- */

export type GeoInfo = { city: string; region: string | null; isp: string | null };

/** 查询失败后的重试间隔：10 分钟。免费接口限 45 次/分钟，限流抖动几分钟就能自愈，
 *  别一锁好几天（那会让「新加坡」这类已见过的城市长时间显示成未知） */
const RETRY_MS = 10 * 60_000;
/** 每次后台渲染最多查几个新 IP：既控限流，也别拖慢页面 */
const LOOKUPS_PER_RENDER = 8;
/** 同一时刻只允许一批外部查询在跑：链接预取和真实点击常会并发渲染同一个后台页，
 *  两批并发查询既浪费限流额度，还可能一成一败互相覆盖 */
let geoInFlight = false;

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RE.test(ip) || ip.startsWith("::ffff:127.");
}

/** 落库永远不降级：查成功才写城市；查失败只刷新重试时间，已有的成功结果原样保留。
 *  （修复：早前失败会无条件覆盖成功，出现「先看到新加坡、刷新后变未知城市」） */
function upsertGeo(ip: string, info: GeoInfo | null): void {
  db.prepare(
    `INSERT INTO guest_geo (ip, city, region, isp, ok, resolved_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET
       city        = CASE WHEN excluded.ok = 1 THEN excluded.city   ELSE guest_geo.city   END,
       region      = CASE WHEN excluded.ok = 1 THEN excluded.region ELSE guest_geo.region END,
       isp         = CASE WHEN excluded.ok = 1 THEN excluded.isp    ELSE guest_geo.isp    END,
       ok          = MAX(guest_geo.ok, excluded.ok),
       resolved_at = excluded.resolved_at`
  ).run(ip, info?.city ?? null, info?.region ?? null, info?.isp ?? null, info ? 1 : 0, nowISO());
}

/** 只读缓存的城市信息，不碰外部接口：页面渲染用这个，秒开。
 *  缓存里没有（或失败过期等重试）的给「解析中…」占位；
 *  真正的查询由页面渲染完之后用 after() 放到后台跑（ensureGeo） */
export function geoFromCache(ips: string[]): Map<string, GeoInfo> {
  const out = new Map<string, GeoInfo>();
  const uniq = [...new Set(ips)].slice(0, 60);
  if (uniq.length === 0) return out;
  const freshLine = new Date(Date.now() - RETRY_MS).toISOString();
  const rows = db
    .prepare(`SELECT ip, city, region, isp, ok, resolved_at FROM guest_geo WHERE ip IN (${uniq.map(() => "?").join(",")})`)
    .all(...uniq) as { ip: string; city: string | null; region: string | null; isp: string | null; ok: number; resolved_at: string }[];
  const cached = new Map(rows.map((r) => [r.ip, r]));
  for (const ip of uniq) {
    if (isPrivateIp(ip)) {
      out.set(ip, { city: "本地/内网", region: null, isp: null });
      continue;
    }
    const c = cached.get(ip);
    if (c && (c.ok === 1 || c.resolved_at >= freshLine)) {
      out.set(ip, { city: c.city ?? "未知城市", region: c.region, isp: c.isp });
    } else {
      out.set(ip, { city: "解析中…", region: null, isp: null });
    }
  }
  return out;
}

/** 给一批 IP 补齐城市信息：内网 IP 直接标「本地网络」，公网 IP 查接口 */
export async function ensureGeo(ips: string[]): Promise<Map<string, GeoInfo>> {
  const out = new Map<string, GeoInfo>();
  const uniq = [...new Set(ips)].slice(0, 60);
  if (uniq.length === 0) return out;
  const freshLine = new Date(Date.now() - RETRY_MS).toISOString();

  const needLookup: string[] = [];
  const rows = db
    .prepare(`SELECT ip, city, region, isp, ok, resolved_at FROM guest_geo WHERE ip IN (${uniq.map(() => "?").join(",")})`)
    .all(...uniq) as { ip: string; city: string | null; region: string | null; isp: string | null; ok: number; resolved_at: string }[];
  const cached = new Map(rows.map((r) => [r.ip, r]));
  for (const ip of uniq) {
    if (isPrivateIp(ip)) {
      out.set(ip, { city: "本地/内网", region: null, isp: null });
      continue;
    }
    const c = cached.get(ip);
    if (c && (c.ok === 1 || c.resolved_at >= freshLine)) {
      out.set(ip, { city: c.city ?? "未知城市", region: c.region, isp: c.isp });
      continue;
    }
    needLookup.push(ip);
  }
  if (needLookup.length === 0) return out;

  // 另一批查询还在跑：这次先不查（没缓存的给占位），下回进来再看结果
  if (geoInFlight) {
    for (const ip of needLookup) out.set(ip, { city: "解析中…", region: null, isp: null });
    return out;
  }
  geoInFlight = true;
  try {
    let rateLimited = false;
    for (const ip of needLookup.slice(0, LOOKUPS_PER_RENDER)) {
      if (rateLimited) {
        out.set(ip, { city: "解析中…", region: null, isp: null });
        continue;
      }
      let info: GeoInfo | null = null;
      try {
        const res = await fetch(
          `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,isp&lang=zh-CN`,
          { signal: AbortSignal.timeout(4000), headers: { "User-Agent": "our-little-planet-visitor-geo/1.0" } }
        );
        if (res.status === 429) {
          // 免费额度用完：这一批剩下的都不查也不记失败，下次进来接着试
          rateLimited = true;
          out.set(ip, { city: "解析中…", region: null, isp: null });
          continue;
        }
        if (res.ok) {
          const d = (await res.json()) as { status?: string; country?: string; regionName?: string; city?: string; isp?: string };
          if (d.status === "success") {
            info = { city: d.city || d.country || "未知城市", region: d.regionName ?? null, isp: d.isp ?? null };
          }
        }
      } catch {
        /* 网络不通/超时：记失败，10 分钟后再试 */
      }
      upsertGeo(ip, info);
      out.set(ip, info ?? { city: "未知城市", region: null, isp: null });
    }
  } finally {
    geoInFlight = false;
  }
  // 这轮没轮到查的先给个占位
  for (const ip of needLookup.slice(LOOKUPS_PER_RENDER)) out.set(ip, { city: "解析中…", region: null, isp: null });
  return out;
}
