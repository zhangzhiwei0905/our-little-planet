import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { ArrowLeft, GlobeHemisphereWest, MapPin, Phone, Robot } from "@phosphor-icons/react/dist/ssr";
import { isAuthor } from "@/lib/auth";
import { recordGuestVisitFor, ensureGeo, geoFromCache, visitorStats } from "@/lib/visitors";
import { PenGate } from "@/components/write/PenGate";
import { DoodleDivider } from "@/components/journal/DoodleDivider";
import { Sticker } from "@/components/journal/Sticker";
import { READER_NAME } from "@/lib/reader";

export const metadata: Metadata = { title: "访客记录" };

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const PATH_LABEL: Record<string, string> = {
  "/": "首页",
  "/journal": "手账",
  "/album": "相册",
  "/quotes": "语录",
  "/letters": "信箱",
  "/timeline": "大事记",
  "/write": "作者后台门口",
  "/lock": "解锁页",
};

function pathLabel(p: string): string {
  if (PATH_LABEL[p]) return PATH_LABEL[p];
  if (p.startsWith("/someday")) return "彩蛋页";
  if (p.startsWith("/journal")) return "手账";
  return p;
}

/** 访客记录：谁（IP/城市/设备）什么时候来过、翻开过哪些页。
 *  未登录的访客只能识别到 IP 层面，城市由公开 GeoIP 接口解析；
 *  她（和作者）带着登录 cookie，不会出现在这里 */
export default async function VisitorsPage() {
  await recordGuestVisitFor("/write/visitors");
  if (!(await isAuthor())) return <PenGate />;
  const stats = visitorStats();
  const ips = stats.visitors.map((v) => v.ip);
  // 页面只读缓存（秒开）；没解析到的先显示「解析中…」，外部 GeoIP 查询放到
  // 响应结束后的后台去做，下次刷新就能看到城市——别让接口拖住整页渲染
  const geo = geoFromCache(ips);
  after(async () => {
    await ensureGeo(ips);
  });

  return (
    <div className="py-10">
      <header className="text-center">
        <p className="font-script text-2xl text-rose-deep">who stopped by</p>
        <h1 className="mt-2 text-4xl font-bold">访客记录</h1>
        <p className="mt-3 text-ink-soft">没有登录的人翻开这本本子的痕迹</p>
        <DoodleDivider variant="wave" className="mx-auto mt-6" />
        <Link href="/write" className="link-soft mt-5 text-sm">
          <ArrowLeft weight="bold" className="size-3.5" />
          回到写作后台
        </Link>
      </header>

      {/* 总览 */}
      <div className="mx-auto mt-10 grid max-w-3xl grid-cols-3 gap-3">
        <div className="card-paper px-4 py-5 text-center">
          <p className="font-round text-3xl font-bold text-rose-deep">{stats.uv}</p>
          <p className="mt-1 text-sm text-ink-soft">独立访客（人）</p>
        </div>
        <div className="card-paper px-4 py-5 text-center">
          <p className="font-round text-3xl font-bold text-rose-deep">{stats.pv}</p>
          <p className="mt-1 text-sm text-ink-soft">累计打开（次）</p>
        </div>
        <div className="card-paper px-4 py-5 text-center">
          <p className="font-round text-3xl font-bold text-rose-deep">
            {stats.todayUv}
            <span className="text-base font-bold text-ink-soft"> 人</span> · {stats.todayPv}
            <span className="text-base font-bold text-ink-soft"> 次</span>
          </p>
          <p className="mt-1 text-sm text-ink-soft">今天</p>
        </div>
      </div>

      {stats.visitors.length === 0 ? (
        <div className="card-paper mx-auto mt-10 flex max-w-md flex-col items-center gap-4 py-14 text-center">
          <Sticker name="star" className="size-12 text-butter" />
          <p className="text-ink-soft">还没有访客来过。等有人点开链接，这里就会亮起来</p>
        </div>
      ) : (
        <>
          {/* 每位访客 */}
          <section className="mx-auto mt-10 max-w-4xl">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
              <MapPin weight="fill" className="size-5 text-rose-deep/70" />
              来过的人
            </h2>
            <ul className="space-y-3">
              {stats.visitors.map((v) => {
                const g = geo.get(v.ip);
                return (
                  <li key={v.ip} className="card-paper flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                    <div className="min-w-40">
                      <p className="font-bold">
                        {g?.city ?? "未知城市"}
                        {g?.region && g.region !== g?.city ? <span className="ml-1 text-sm font-normal text-ink-soft">{g.region}</span> : null}
                      </p>
                      <p className="mt-0.5 font-round text-xs tracking-wider text-ink-soft">
                        {v.ip}
                        {g?.isp ? ` · ${g.isp}` : ""}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-mist/50 px-2.5 py-0.5 text-xs font-bold text-ink">
                      <Phone weight="fill" className="size-3" />
                      {v.device}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap gap-1">
                        {v.paths.map((p) => (
                          <span key={p} className="rounded-full bg-paper-deep px-2 py-0.5 font-hand text-xs text-ink-soft">
                            {pathLabel(p)}
                          </span>
                        ))}
                      </p>
                    </div>
                    <div className="text-right font-round text-xs tracking-wider text-ink-soft">
                      <p>
                        来过 <span className="font-bold text-ink">{v.visits}</span> 次
                        {v.bots > 0 && (
                          <span className="ml-1 inline-flex items-center gap-0.5 opacity-70">
                            <Robot weight="fill" className="size-3" />
                            混有爬虫
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5">最近 {fmt(v.lastAt)}</p>
                      <p className="mt-0.5 opacity-70">首次 {fmt(v.firstAt)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* 最近动态 */}
          <section className="mx-auto mt-10 max-w-4xl">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
              <GlobeHemisphereWest weight="fill" className="size-5 text-rose-deep/70" />
              最近打开
            </h2>
            <ul className="card-paper divide-y divide-ink/8 px-5">
              {stats.recent.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                  <span className="font-round text-xs tracking-wider text-ink-soft">{fmt(r.createdAt)}</span>
                  <span className="font-bold">{r.bot ? "爬虫" : geo.get(r.ip)?.city ?? r.ip}</span>
                  <span className="text-ink-soft">翻开了</span>
                  <span className="rounded-full bg-paper-deep px-2 py-0.5 font-hand text-xs">{pathLabel(r.path)}</span>
                  <span className="ml-auto font-round text-xs text-ink-soft/70">{r.device}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 px-1 text-xs leading-relaxed text-ink-soft/70">
              只记录未登录访客的 IP、大致城市和翻过的页面（30 秒内重复刷新不重复计数，爬虫另行标记）；
              {READER_NAME}和你登录后的浏览不会出现在这里。城市由公开 GeoIP 接口解析，仅供参考。
            </p>
          </section>
        </>
      )}
    </div>
  );
}
