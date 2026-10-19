import { createHash } from "node:crypto";
import { cookies } from "next/headers";

export const READER_COOKIE = "journal_key"; // 读者：能翻开本子
export const AUTHOR_COOKIE = "journal_pen"; // 作者：能写
export const SOMEDAY_COOKIE = "journal_someday"; // Someday 彩蛋：揭晓后解锁

export function authSecret(): string {
  return process.env.AUTH_SECRET ?? "insecure-dev-secret-change-me";
}

/** cookie 里存的不是密码，是 密钥+角色 的 SHA-256 摘要 */
export function tokenFor(role: "reader" | "author" | "someday" | (`egg:${string}`)): string {
  return createHash("sha256").update(`${authSecret()}:${role}`).digest("hex");
}

/* ---- 作者会话：限时令牌 ----
 *  格式 `<签名>.<签发时间ms>`，签名把签发时间一起搅进哈希。
 *  默认 AUTHOR_SESSION_HOURS 小时（缺省 6）后过期，要重新输作者口令；
 *  登录时勾「记住这台设备」才给 30 天。避免「在别人手机上登录过一次，
 *  后台权限就挂一年」。旧格式（纯哈希、没有时间戳）的 cookie 一律视为
 *  过期——新版一上线，历史上发出去的作者会话全部立即登出。 */

export function authorSessionHours(): number {
  const n = Number(process.env.AUTHOR_SESSION_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

export function authorToken(issuedAt = Date.now()): string {
  const sig = createHash("sha256").update(`${authSecret()}:author:${issuedAt}`).digest("hex");
  return `${sig}.${issuedAt}`;
}

function validAuthorToken(raw: string | undefined): boolean {
  if (!raw) return false;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return false;
  const sig = raw.slice(0, dot);
  const issuedAt = Number(raw.slice(dot + 1));
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;
  if (Date.now() - issuedAt > authorSessionHours() * 3600_000) return false;
  if (issuedAt - Date.now() > 60_000) return false; // 容忍 1 分钟时钟偏差
  const expect = createHash("sha256").update(`${authSecret()}:author:${issuedAt}`).digest("hex");
  return expect === sig;
}

/** 作者 cookie 的时效：勾了「记住这台设备」给 30 天，否则按 AUTHOR_SESSION_HOURS */
export function authorCookieOpts(remember: boolean) {
  const hours = remember ? 24 * 30 : authorSessionHours();
  return { ...COOKIE_OPTS, maxAge: hours * 3600 };
}

export function checkPassword(role: "reader" | "author", input: unknown): boolean {
  if (typeof input !== "string" || input.length === 0 || input.length > 128) return false;
  const expected =
    role === "reader"
      ? process.env.READER_PASSWORD ?? "0520"
      : process.env.AUTHOR_PASSWORD ?? "write-for-her";
  return input === expected;
}

export async function isReader(): Promise<boolean> {
  const c = await cookies();
  return c.get(READER_COOKIE)?.value === tokenFor("reader") || c.get(AUTHOR_COOKIE)?.value === tokenFor("author");
}

export async function isAuthor(): Promise<boolean> {
  const c = await cookies();
  return validAuthorToken(c.get(AUTHOR_COOKIE)?.value);
}

/** Someday 彩蛋是否已解锁：输过彩蛋密码，或作者本人（作者随时预览） */
export async function isSomedayUnlocked(): Promise<boolean> {
  if (await isAuthor()) return true;
  const c = await cookies();
  return c.get(SOMEDAY_COOKIE)?.value === tokenFor("someday");
}

/** 单个彩蛋是否已解锁（每个彩蛋独立 cookie） */
export async function isEggUnlocked(eggId: string): Promise<boolean> {
  if (await isAuthor()) return true;
  const c = await cookies();
  return c.get(`egg_${eggId}`)?.value === tokenFor(`egg:${eggId}`);
}

/** 彩蛋解锁 cookie 名 */
export function eggCookieName(eggId: string): string {
  return `egg_${eggId}`;
}

export const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  secure: process.env.NODE_ENV === "production",
};
