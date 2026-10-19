import { cn } from "@/lib/cn";

/** 邮票：白边打孔 + 微微倾斜。径向渐变阵列做齿孔，内层盖住中间的孔 */
export function Stamp({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative rotate-[-2deg]", className)}>
      <div
        aria-hidden
        className="absolute inset-0 rounded-[2px] shadow-card [background:radial-gradient(circle_5px,transparent_4.6px,#fff_5.2px)_0_0/13px_13px]"
      />
      <div className="relative m-[7px] bg-white p-1.5">{children}</div>
    </div>
  );
}
