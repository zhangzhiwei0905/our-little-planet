"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

type Tone = "ok" | "error";
type ToastItem = { id: number; text: string; tone: Tone };
type PushToast = (text: string, tone?: Tone) => void;

const ToastCtx = createContext<PushToast>(() => undefined);

/** 全站气泡通知：toast("已保存") / toast("出错了", "error") */
export function useToast(): PushToast {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const reduce = useReducedMotion();

  const push = useCallback<PushToast>((text, tone = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* 顶部气泡栈：不挡点击，位于导航之下、纸纹之上 */}
      <div className="pointer-events-none fixed inset-x-0 top-20 z-[70] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              role="status"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.96 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                "pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-full border px-5 py-2.5 font-bold shadow-lifted",
                t.tone === "ok"
                  ? "border-matcha/50 bg-card text-ink"
                  : "border-rose/50 bg-rose-soft text-rose-deep"
              )}
            >
              {t.tone === "ok" ? (
                <CheckCircle weight="fill" className="size-5 shrink-0 text-matcha" />
              ) : (
                <WarningCircle weight="fill" className="size-5 shrink-0 text-rose-deep" />
              )}
              <span className="text-sm">{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
