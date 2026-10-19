import type { CSSProperties } from "react";
import { Sticker } from "@/components/journal/Sticker";
import type { BoardElement } from "@/lib/board";

/** 自由拼贴页的渲染原语：只管元素长什么样，摆放（定位/选中框/拖拽）由外层负责。
 *  坐标归一化（x/w 相对页宽，y/h 相对页高），配合 .board-page 的容器查询单位渲染 */

const FONT_CLASS: Record<string, string> = {
  hand: "font-hand",
  round: "font-round",
  script: "font-script",
};

/** 元素的定位样式：绝对定位 + cqw/cqh 百分比尺寸（笔迹没有位置盒子） */
export function boardElementStyle(el: BoardElement): CSSProperties {
  if (el.t === "stroke") return {};
  if (el.t === "image") {
    return {
      position: "absolute",
      left: `${el.x * 100}cqw`,
      top: `${el.y * 100}cqh`,
      width: `${el.w * 100}cqw`,
      height: `${el.h * 100}cqh`,
    };
  }
  if (el.t === "sticker") {
    return {
      position: "absolute",
      left: `${el.x * 100}cqw`,
      top: `${el.y * 100}cqh`,
      width: `${el.w * 100}cqw`,
      aspectRatio: "1 / 1",
    };
  }
  return {
    position: "absolute",
    left: `${el.x * 100}cqw`,
    top: `${el.y * 100}cqh`,
    width: `${el.w * 100}cqw`,
  };
}

/** 元素内容（撑满外层给的盒子） */
export function BoardElementBody({ el }: { el: BoardElement }) {
  if (el.t === "text") {
    return (
      <p
        className={`w-full whitespace-pre-wrap break-words leading-snug ${FONT_CLASS[el.font] ?? "font-hand"}`}
        style={{ fontSize: `${el.size * 100}cqw`, color: el.color }}
      >
        {el.text}
      </p>
    );
  }
  if (el.t === "sticker") {
    return <Sticker name={el.name} className="size-full" />;
  }
  if (el.t === "image") {
    return (
      // 鉴权媒体走 /api/media/[id]，next/image 不适用
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/media/${el.media}`}
        alt=""
        draggable={false}
        loading="lazy"
        decoding="async"
        className="size-full rounded-md object-cover shadow-card"
      />
    );
  }
  return null;
}

/** 笔迹层：一条 SVG 画所有 stroke。页面固定 3:4，viewBox 等比，线宽随页宽缩放 */
export function BoardStrokesLayer({ elements }: { elements: Extract<BoardElement, { t: "stroke" }>[] }) {
  if (elements.length === 0) return null;
  return (
    <svg
      viewBox="0 0 300 400"
      preserveAspectRatio="none"
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full"
    >
      {elements.map((s) => (
        <polyline
          key={s.id}
          points={s.pts.map(([x, y]) => `${x * 300},${y * 400}`).join(" ")}
          fill="none"
          stroke={s.color}
          strokeWidth={s.size * 300}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

export function isStroke(el: BoardElement): el is Extract<BoardElement, { t: "stroke" }> {
  return el.t === "stroke";
}
