"use client";

import { useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { Sticker } from "@/components/journal/Sticker";
import { cn } from "@/lib/cn";

const NIGHT = ["这么晚还没睡呀", "夜里翻这些，会做个好梦吧", "嘘，星星困了，本子还醒着", "睡不着的话，就多翻两页"];
const MORNING = ["早呀，新的一天也算数", "太阳刚出来，你也刚醒吗", "清晨的第一眼，给了这本本子"];
const FORENOON = ["上午好，今天也要好好过", "这个点翻开它的人，在想我们吧", "上午的太阳晒在本子上，刚刚好"];
const NOON = ["午安，记得好好吃饭", "中午好，吃饱了再来翻一页", "饭后的十分钟，正好看看我们"];
const AFTERNOON = ["下午好，给你留了杯热咖啡", "犯困的话，看看照片提提神", "下午的光落在本子上，是暖的"];
const DUSK = ["傍晚好，今天的晚霞看了吗", "晚饭时间到，先吃饱再翻", "一天快过去了，你还好吗"];
const EVENING = ["晚上好，今天过得怎么样", "夜色下来了，慢慢翻", "睡前翻一页，先跟你说晚安"];

function pick(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

function greetingFor(now: Date, startDate: string): string {
  // 纪念日优先：周年 > 每月纪念 > 时段问候
  const start = new Date(`${startDate}T00:00:00`);
  if (!Number.isNaN(start.getTime()) && now.getDate() === start.getDate()) {
    const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    if (months >= 12 && months % 12 === 0) {
      const years = months / 12;
      return pick([`今天是我们在一起 ${years} 年的日子`, `${years} 年前的今天，故事翻开了第一页`]);
    }
    if (months >= 1) {
      return pick([
        `今天又是 ${start.getDate()} 号 · 我们满 ${months} 个月啦`,
        `每月的 ${start.getDate()} 号都要开心一下`,
        `第 ${months} 个月纪念，本子替你记着`,
      ]);
    }
  }
  const h = now.getHours();
  if (h >= 23 || h < 5) return pick(NIGHT);
  if (h < 9) return pick(MORNING);
  if (h < 12) return pick(FORENOON);
  if (h < 14) return pick(NOON);
  if (h < 18) return pick(AFTERNOON);
  if (h < 20) return pick(DUSK);
  return pick(EVENING);
}

// 问候语只在客户端出现：走 useSyncExternalStore 的客户端快照，服务端永远渲染空（不闪不跳）；
// 快照必须稳定，挑好的那句按 startDate 缓存，反复读不再换
const emptySubscribe = () => () => {};
const serverSnapshot = () => null;
let cached: { key: string; line: string } | null = null;
function getGreeting(startDate: string): string {
  if (!cached || cached.key !== startDate) {
    cached = { key: startDate, line: greetingFor(new Date(), startDate) };
  }
  return cached.line;
}

/** 首页的时间感知问候：按访问时刻（和纪念日）换一句页边小字，每次进来都可能不一样 */
export function TimeGreeting({ startDate, className }: { startDate: string; className?: string }) {
  const line = useSyncExternalStore(emptySubscribe, () => getGreeting(startDate), serverSnapshot);

  return (
    <p aria-live="polite" className={cn("flex min-h-7 items-center font-script text-xl text-ink-soft/90", className)}>
      {line && (
        <motion.span
          key={line}
          className="inline-flex items-center gap-1.5"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.1, ease: "easeOut" }}
        >
          <Sticker name="sparkle" className="size-4 shrink-0 text-rose/70" />
          {line}
        </motion.span>
      )}
    </p>
  );
}
