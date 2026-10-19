import { timingSafeEqual } from "node:crypto";

/** 速记通道（/api/quick*）的鉴权：Authorization: Bearer <SHORTCUT_TOKEN>（或 x-shortcut-token 头）。
 *  独立于作者 cookie——快捷指令里只放这一个令牌，泄露了改环境变量即可作废，
 *  不会连带交出去整个作者写权限。没配 SHORTCUT_TOKEN 时端点整体关闭。 */
export function quickTokenEnabled(): boolean {
  return Boolean(process.env.SHORTCUT_TOKEN);
}

export function quickTokenMatches(req: Request): boolean {
  const expected = process.env.SHORTCUT_TOKEN ?? "";
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : (req.headers.get("x-shortcut-token") ?? "");
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
