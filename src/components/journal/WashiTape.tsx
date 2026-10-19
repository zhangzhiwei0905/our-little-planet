import { cn } from "@/lib/cn";
import { TAPE_COLORS, type TapeTone } from "@/lib/tilt";

/** 和纸胶带：贴在卡片上缘，颜色和角度传入。
 *  默认由父级定位（如 -top-3 left-1/2），自身做居中与旋转 */
export function WashiTape({
  tone = "rose",
  rotate = -6,
  className,
}: {
  tone?: TapeTone;
  rotate?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("washi-tape", className)}
      style={{ "--tone": TAPE_COLORS[tone], "--r": `${rotate}deg` } as React.CSSProperties}
    />
  );
}
