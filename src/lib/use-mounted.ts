"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => undefined;

/** 组件是否已在浏览器里挂载：SSR / 水合完成前固定 false，挂载后 true。
 *  createPortal 只能挂在浏览器里，灯箱这类 portal 组件用它做闸门，避免水合不一致 */
export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
