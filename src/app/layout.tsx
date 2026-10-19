import type { Metadata } from "next";
import "lxgw-wenkai-webfont/style.css";
import "@fontsource/caveat/400.css";
import "@fontsource/caveat/700.css";
import "@fontsource/baloo-2/500.css";
import "@fontsource/baloo-2/700.css";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { ChunkReloadGuard } from "@/components/ChunkReloadGuard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "我们的小星球", template: "%s · 我们的小星球" },
  description: "一本只属于我们俩的手账",
  robots: { index: false, follow: false },
};

/** 首帧定明暗：存过偏好就用偏好，没存过跟系统走。放在 body 前面内联执行，避免闪一下白纸 */
const THEME_INIT = `try{var t=localStorage.getItem("journal-theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {/* 请求 OSS 图片/音频时不要带 Referer：桶开了防盗链，只认白名单域名和空 Referer，
            这样本地 localhost 调试、换域名部署都不会被 403 拦裂图 */}
        <meta name="referrer" content="no-referrer" />
      </head>
      <body className="flex min-h-full flex-col">
        {/* 纸张纹理：盖在最上层但不挡交互 */}
        <div className="grain" aria-hidden />
        <ChunkReloadGuard />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
