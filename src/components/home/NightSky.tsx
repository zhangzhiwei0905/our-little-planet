"use client";

import { useSyncExternalStore } from "react";
import { Sticker } from "@/components/journal/Sticker";

// 夜不夜只有浏览器知道：客户端快照判断时刻，服务端永远渲染空（不闪不跳）
const emptySubscribe = () => () => {};
const serverSnapshot = () => false;
function isNight(): boolean {
  const h = new Date().getHours();
  return h >= 23 || h < 5;
}

/** 深夜彩蛋：23 点到凌晨 5 点之间翻开首页，月亮和几颗小星星会出来眨眼睛。
 *  「减少动态」由全局 CSS 降级停闪 */
export function NightSky() {
  const night = useSyncExternalStore(emptySubscribe, isNight, serverSnapshot);
  if (!night) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      <Sticker name="moon" className="absolute right-[6%] top-2 size-8 rotate-12 text-butter/90" />
      <span
        className="twinkle absolute right-[15%] top-[20%]"
        style={{ "--tw": "-8deg", "--tw-d": "2.8s" } as React.CSSProperties}
      >
        <Sticker name="star" className="size-5 text-butter/80" />
      </span>
      <span
        className="twinkle absolute right-[3%] top-[44%]"
        style={{ "--tw": "6deg", "--tw-d": "3.4s", "--tw-delay": "0.9s" } as React.CSSProperties}
      >
        <Sticker name="sparkle" className="size-4 text-butter/70" />
      </span>
      <span
        className="twinkle absolute left-[2%] top-[10%]"
        style={{ "--tw": "-12deg", "--tw-d": "3s", "--tw-delay": "1.6s" } as React.CSSProperties}
      >
        <Sticker name="star" className="size-4 text-butter/60" />
      </span>
    </div>
  );
}
