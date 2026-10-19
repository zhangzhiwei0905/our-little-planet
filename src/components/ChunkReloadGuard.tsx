"use client";

import { useEffect } from "react";

/** 部署自愈：重新部署会清掉旧构建的 JS chunk，一直开着的标签页再点进去
 *  会拿旧脚本请求已删除的文件（ChunkLoadError），页面残缺或整块空白。
 *  检测到这类错误就整页刷新一次，拿新版本（sessionStorage 防刷新循环）。 */
export function ChunkReloadGuard() {
  useEffect(() => {
    const STALE = /ChunkLoadError|Failed to fetch dynamically imported|error loading dynamically imported|Importing a module script failed/i;
    const onError = (e: ErrorEvent) => {
      if (!STALE.test(String(e?.message ?? ""))) return;
      try {
        if (sessionStorage.getItem("_chunkReloaded")) return;
        sessionStorage.setItem("_chunkReloaded", "1");
      } catch {
        /* 隐私模式就算了 */
      }
      window.location.reload();
    };
    window.addEventListener("error", onError);
    return () => window.removeEventListener("error", onError);
  }, []);
  return null;
}
