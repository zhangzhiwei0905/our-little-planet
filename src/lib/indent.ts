import type { KeyboardEvent } from "react";

/** textarea 里按 Tab：插入两个全角空格缩进（中文信件习惯），而不是把焦点切走 */
export function indentOnTab(
  e: KeyboardEvent<HTMLTextAreaElement>,
  setValue: (v: string) => void
): void {
  if (e.key !== "Tab" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  const ta = e.currentTarget;
  const { selectionStart, selectionEnd, value } = ta;
  const INDENT = "　　";
  setValue(value.slice(0, selectionStart) + INDENT + value.slice(selectionEnd));
  requestAnimationFrame(() => {
    ta.selectionStart = ta.selectionEnd = selectionStart + INDENT.length;
  });
}
