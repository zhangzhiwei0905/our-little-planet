import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 原生模块和自带 WASM 的包不做打包，运行时按 Node 原生方式加载
  serverExternalPackages: ["better-sqlite3", "sharp", "heic-convert", "libheif-js"],
  // 部署时可用 NEXT_DIST_DIR=.next-new 先在旁边构建，完成后整体换名上线，
  // 避免构建过程中旧进程的 chunk 被替换掉、线上出现一分钟左右的报错窗口
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
