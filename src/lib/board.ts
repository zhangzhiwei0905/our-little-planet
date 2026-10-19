import { isStickerName, type StickerName } from "@/components/journal/Sticker";

/** 自由拼贴页（board）的元素模型。
 *  坐标全部归一化：x/w 相对页宽，y/h 相对页高，页面固定 3:4 竖页，
 *  渲染时用容器查询单位（cqw/cqh）按百分比摆放，任意屏宽下布局一致。
 *  元素允许略微出界（-0.1 ~ 1.2），贴出纸边更有手账味 */

export type BoardTextFont = "hand" | "round" | "script";

export type BoardElement =
  | { id: string; t: "text"; x: number; y: number; w: number; text: string; font: BoardTextFont; size: number; color: string }
  | { id: string; t: "sticker"; x: number; y: number; w: number; name: StickerName; color: string }
  | { id: string; t: "image"; x: number; y: number; w: number; h: number; media: string }
  | { id: string; t: "stroke"; color: string; size: number; pts: number[][] };

export type BoardLayout = { elements: BoardElement[] };

export const BOARD_ASPECT = 3 / 4; // 宽:高，手账本是竖页

/** 文字与画笔共用四色（奶油纸上都看得清） */
export const BOARD_COLORS = [
  { color: "#5C4A42", label: "墨棕" },
  { color: "#C9647F", label: "玫瑰" },
  { color: "#3E7C59", label: "抹茶" },
  { color: "#4E7A96", label: "雾蓝" },
] as const;

export const STICKER_W = 0.18; // 贴纸固定初始大小（占页宽比例），贴出来后可缩放
export const TEXT_W = 0.7;
export const TEXT_SIZE = 0.05;
export const IMAGE_W = 0.5;
export const PEN_SIZES = [0.004, 0.009, 0.016];

const DEFAULT_COLOR = BOARD_COLORS[0].color;
function colorOr(v: unknown): string {
  return typeof v === "string" && BOARD_COLORS.some((c) => c.color === v) ? v : DEFAULT_COLOR;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function clampPos(v: number): number {
  return Math.min(1.2, Math.max(-0.1, v));
}
function genId(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** 入库前清洗：按类型走白名单字段 + 数值收敛，认不出的元素直接丢弃。
 *  返回 JSON 字符串（存 entries.layout），坏数据返回 null */
export function sanitizeBoardLayout(raw: unknown): string | null {
  let data: unknown = raw;
  if (typeof data === "string") {
    if (data.length > 500_000) return null;
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (data == null || typeof data !== "object") return null;
  const els = (data as { elements?: unknown }).elements;
  if (!Array.isArray(els) || els.length > 400) return null;

  const elements: BoardElement[] = [];
  for (const e of els) {
    if (typeof e !== "object" || e === null) continue;
    const el = e as Record<string, unknown>;
    const id = typeof el.id === "string" && el.id ? el.id.slice(0, 24) : genId();
    if (el.t === "text" && typeof el.text === "string") {
      elements.push({
        id,
        t: "text",
        x: clampPos(num(el.x)),
        y: clampPos(num(el.y)),
        w: Math.min(1, Math.max(0.05, num(el.w, TEXT_W))),
        text: el.text.slice(0, 800),
        font: el.font === "round" || el.font === "script" ? el.font : "hand",
        size: Math.min(0.2, Math.max(0.02, num(el.size, TEXT_SIZE))),
        color: colorOr(el.color),
      });
    } else if (el.t === "sticker" && typeof el.name === "string" && isStickerName(el.name)) {
      elements.push({
        id,
        t: "sticker",
        x: clampPos(num(el.x)),
        y: clampPos(num(el.y)),
        w: Math.min(1, Math.max(0.04, num(el.w, STICKER_W))),
        name: el.name,
        color: colorOr(el.color),
      });
    } else if (el.t === "image" && typeof el.media === "string" && /^[a-f0-9]{8,16}$/.test(el.media)) {
      elements.push({
        id,
        t: "image",
        x: clampPos(num(el.x)),
        y: clampPos(num(el.y)),
        w: Math.min(1.2, Math.max(0.04, num(el.w, IMAGE_W))),
        h: Math.min(1.6, Math.max(0.04, num(el.h, 0.62))),
        media: el.media,
      });
    } else if (el.t === "stroke" && Array.isArray(el.pts)) {
      const pts = el.pts
        .filter(
          (p): p is number[] =>
            Array.isArray(p) && p.length >= 2 && p.every((n) => typeof n === "number" && Number.isFinite(n))
        )
        .slice(0, 1200);
      if (pts.length === 0) continue;
      elements.push({
        id,
        t: "stroke",
        color: colorOr(el.color),
        size: Math.min(0.05, Math.max(0.001, num(el.size, 0.009))),
        pts,
      });
    }
  }
  return JSON.stringify({ elements });
}

/** 读出来时解析（存的都是清洗过的合法 JSON，这里只兜底） */
export function parseBoardLayout(raw: string | null): BoardLayout | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as BoardLayout;
    return Array.isArray(data?.elements) ? data : null;
  } catch {
    return null;
  }
}
