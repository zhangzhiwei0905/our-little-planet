"use client";

import Link from "next/link";
import {
  Camera,
  ChatTeardropText,
  EnvelopeSimple,
  FlagBanner,
  Notebook,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

/** 图标按名字传：页面（服务端组件）不直接 import phosphor 图标（它内部用了 createContext） */
const ICONS: Record<string, Icon> = {
  notebook: Notebook,
  camera: Camera,
  quote: ChatTeardropText,
  letter: EnvelopeSimple,
  milestone: FlagBanner,
};

/** 菜单页头部的小添加入口（仅作者可见）：跳到 /write 对应的新增模块 */
export function AddEntryButton({
  href,
  icon,
  label,
  className,
}: {
  href: string;
  icon: keyof typeof ICONS;
  label: string;
  className?: string;
}) {
  const Icon = ICONS[icon];
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border-2 border-dashed border-ink/20 bg-card px-4 py-2 text-sm font-bold text-ink-soft shadow-card transition-all duration-300 ease-spring",
        "hover:-translate-y-0.5 hover:border-rose hover:bg-rose-soft/40 hover:text-ink hover:shadow-md",
        className
      )}
    >
      <Icon weight="bold" className="size-4 text-rose-deep" />
      {label}
    </Link>
  );
}
