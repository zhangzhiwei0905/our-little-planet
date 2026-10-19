"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { PenNib } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

/** /write 的作者口令门。笔是限时的：不勾「这台设备是我自己的」，
 *  默认几小时后自动收回（在别人手机上拿过一次笔也不会一直挂着） */
export function PenGate({ demoHint }: { demoHint?: string }) {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/pen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, remember }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      setError("这不是作者的口令哦");
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
    <div className="flex min-h-[60vh] items-center justify-center py-16">
      <form onSubmit={submit} className={cn("card-paper w-full max-w-sm px-8 py-10 text-center", shake && "shake")}>
        <p className="text-rose-deep">
          <PenNib weight="fill" className="mx-auto size-9" />
        </p>
        <h1 className="mt-4 text-3xl font-bold">这里是作者专座</h1>
        <p className="mt-3 text-ink-soft">输入只有你知道的口令，拿起笔</p>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="作者口令"
          autoFocus
          autoComplete="off"
          aria-label="作者口令"
          className={cn(
            "mt-7 w-full rounded-2xl border-2 bg-paper px-4 py-3 text-center text-lg tracking-[0.2em] placeholder:tracking-normal placeholder:text-ink-soft/50",
            error ? "border-rose-deep/60" : "border-ink/15 focus:border-rose"
          )}
        />
        {error && <p className="mt-3 text-sm font-bold text-rose-deep">{error}</p>}
        {demoHint && (
          <p className="mt-3 rounded-full bg-butter/50 px-3 py-1.5 text-xs font-bold text-ink-soft">🌱 {demoHint}</p>
        )}
        <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="size-4 accent-rose-deep"
          />
          这台设备是我自己的（30 天内不用再输）
        </label>
        <button type="submit" disabled={busy || password.length === 0} className="btn-primary mt-5 w-full justify-center">
          {busy ? "正在拿笔…" : "拿起笔"}
        </button>
        <Link href="/" className="link-soft mt-5 text-sm">
          我不是作者，回到手账
        </Link>
      </form>
    </div>
  );
}
