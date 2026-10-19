import { Fragment, type ReactNode } from "react";

/** 轻量排版：空行分段、单换行转行、**加粗** 强调（玫瑰深色）。
 *  直接构建 React 节点，不走 innerHTML，天然安全。
 *  lined = 信纸模式：行高交给信纸的横线，段间距为一整行 */
export function EntryText({ text, lined = false }: { text: string; lined?: boolean }) {
  const paragraphs = text.replaceAll("\r\n", "\n").split(/\n{2,}/);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className={lined ? "[&:not(:first-child)]:mt-[2.2rem]" : "leading-loose"}>
          {inline(p)}
        </p>
      ))}
    </>
  );
}

function inline(p: string): ReactNode[] {
  const parts = p.split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-bold text-rose-deep">
          {part.slice(2, -2)}
        </strong>
      );
    }
    const lines = part.split("\n");
    return (
      <Fragment key={i}>
        {lines.map((line, j) => (
          <Fragment key={j}>
            {line}
            {j < lines.length - 1 && <br />}
          </Fragment>
        ))}
      </Fragment>
    );
  });
}
