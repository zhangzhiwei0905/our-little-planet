import { NextResponse } from "next/server";
import {
  AUTHOR_COOKIE,
  COOKIE_OPTS,
  READER_COOKIE,
  authorCookieOpts,
  authorToken,
  checkPassword,
  tokenFor,
} from "@/lib/auth";

/** 解锁：读者密码或作者口令都能翻开本子；作者口令同时拿到笔。
 *  作者会话是限时的（默认 AUTHOR_SESSION_HOURS 小时，勾 remember 才 30 天），
 *  读者会话照旧长期有效 */
export async function POST(req: Request) {
  const { password, remember } = (await req.json().catch(() => ({}))) as {
    password?: string;
    remember?: boolean;
  };
  const isReaderPw = checkPassword("reader", password);
  const isAuthorPw = checkPassword("author", password);
  if (!isReaderPw && !isAuthorPw) {
    return NextResponse.json({ error: "密码好像不对哦，再想想？" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(READER_COOKIE, tokenFor("reader"), COOKIE_OPTS);
  if (isAuthorPw) {
    res.cookies.set(AUTHOR_COOKIE, authorToken(), authorCookieOpts(remember === true));
  }
  return res;
}

/** 合上本子 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(READER_COOKIE);
  res.cookies.delete(AUTHOR_COOKIE);
  return res;
}
