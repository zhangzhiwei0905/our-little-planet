"use client";

import { useRef, useState } from "react";
import { Gift } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

/** 彩蛋密码门：日期到了，还差最后一串密码 */
export function EggGate({ eggId, title }: { eggId: string; title: string }) {
  const [password, setPassword] = useState("");
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
      const res = await fetch(`/api/eggs/${eggId}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "打不开哦");
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
    <form onSubmit={submit} className={cn("card-paper w-full max-w-sm px-8 py-10 text-center", shake && "shake")}>
      <p className="text-rose-deep">
        <Gift weight="fill" className="mx-auto size-9" />
      </p>
      <h1 className="mt-4 text-3xl font-bold">{title}</h1>
      <p className="mt-3 text-ink-soft">
        这一天到了。这里藏着一份礼物，还差一串只有你知道的密码。
      </p>
      <input
        ref={inputRef}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="只有你知道的那串字"
        autoFocus
        autoComplete="off"
        aria-label="彩蛋密码"
        className={cn(
          "mt-7 w-full rounded-2xl border-2 bg-paper px-4 py-3 text-center text-lg tracking-[0.2em] placeholder:tracking-normal placeholder:text-ink-soft/50",
          error ? "border-rose-deep/60" : "border-ink/15 focus:border-rose"
        )}
      />
      {error && <p className="mt-3 text-sm font-bold text-rose-deep">{error}</p>}
      <button type="submit" disabled={busy || password.length === 0} className="btn-primary mt-6 w-full justify-center">
        {busy ? "正在拆开…" : "打开它"}
      </button>
    </form>
  );
}
