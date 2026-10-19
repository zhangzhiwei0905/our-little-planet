"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Lock, LockKeyOpen } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { BookFlip } from "./BookFlip";
import { READER_NAME } from "@/lib/reader";

/** 日记本锁扣：输入那串只有你们俩懂的密码。
 *  解开的瞬间不急着跳页——锁扣先弹开，然后全屏演一段「翻开本子」，翻页演完再进首页。
 *  这里是给她（读者）用的门：读者会话一年有效，不用「记住设备」；
 *  作者请去 /write 登录，那边才有 30 天记住选项 */
export function LockForm({ next }: { next?: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [shake, setShake] = useState(false);
  const [book, setBook] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotion();

  function goHome() {
    window.location.href = next && next.startsWith("/") ? next : "/";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || opened) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // 刚设置解锁 cookie，必须全页跳转让服务端重新渲染；客户端路由会撞 RSC 缓存。
        // 跳之前先把「锁扣弹开 + 翻开本子」演完（减少动态偏好的读者直接走）
        if (reduce) {
          goHome();
          return;
        }
        setOpened(true);
        setBook(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "密码好像不对哦，再想想？");
      setShake(true);
      setTimeout(() => setShake(false), 500);
      inputRef.current?.focus();
      inputRef.current?.select();
    } catch {
      setError("网络好像打了个盹，再试一次？");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm [perspective:1200px]">
      <motion.form
        onSubmit={submit}
        style={{ transformOrigin: "left center" }}
        animate={opened ? { rotateY: -26, x: -18, opacity: 0, scale: 1.02 } : { rotateY: 0, x: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
        className={cn("card-paper w-full px-8 py-10 text-center", shake && "shake")}
      >
        <p className="text-ink-soft/60">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={opened ? "open" : "locked"}
              className={cn("inline-block", opened && "text-rose-deep")}
              initial={{ scale: 0.5, rotate: -24, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              exit={{ scale: 0.6, rotate: 18, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 17 }}
            >
              {opened ? <LockKeyOpen weight="fill" className="size-9" /> : <Lock weight="fill" className="size-9" />}
            </motion.span>
          </AnimatePresence>
        </p>
        <h1 className="mt-4 text-3xl font-bold">{opened ? "锁扣弹开啦" : `这是${READER_NAME}的专属`}</h1>
        <p className="mt-3 text-ink-soft">{opened ? "封面正在翻开……" : "这本手账大部分内容只给她看，输密码就能以她的身份进来"}</p>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="嗯…是哪个日子来着"
          autoFocus
          autoComplete="off"
          disabled={opened}
          aria-label="解锁密码"
          className={cn(
            "mt-7 w-full rounded-2xl border-2 bg-paper px-4 py-3 text-center text-lg tracking-[0.3em] placeholder:tracking-normal placeholder:text-ink-soft/50",
            error ? "border-rose-deep/60" : "border-ink/15 focus:border-rose"
          )}
        />
        {error && <p className="mt-3 text-sm font-bold text-rose-deep">{error}</p>}
        <button type="submit" disabled={busy || opened || password.length === 0} className="btn-primary mt-6 w-full justify-center">
          <LockKeyOpen weight="bold" className="size-5" />
          {opened ? "翻开啦" : busy ? "正在开锁…" : "解开锁扣"}
        </button>
        {/* 不是她也没关系：访客模式随处可以进，看公开的那些就好 */}
        <button
          type="button"
          onClick={goHome}
          disabled={opened}
          className="mt-3 w-full rounded-full border border-ink/15 px-4 py-2.5 text-sm font-bold text-ink-soft transition hover:bg-ink/5 hover:text-ink disabled:opacity-50"
        >
          先随便逛逛（访客模式）
        </button>
        <p className="mt-6 font-script text-xl text-ink-soft/60">psst. 忘了的话，只有他知道</p>
      </motion.form>
      {book && <BookFlip phase="opening" onDone={goHome} />}
    </div>
  );
}
