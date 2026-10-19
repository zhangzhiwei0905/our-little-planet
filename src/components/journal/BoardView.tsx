import { boardElementStyle, BoardElementBody, BoardStrokesLayer, isStroke } from "./board-parts";
import type { BoardLayout } from "@/lib/board";

/** 自由拼贴页（只读）：按保存的布局把文字/贴纸/图片/笔迹摆到一张 3:4 的纸页上 */
export function BoardView({ layout }: { layout: BoardLayout | null }) {
  const elements = layout?.elements ?? [];
  return (
    <div className="board-page relative w-full select-none overflow-hidden rounded-xl border border-ink/10 shadow-card [-webkit-touch-callout:none]">
      {elements.filter((e) => !isStroke(e)).map((el) => (
        <div key={el.id} style={boardElementStyle(el)}>
          <BoardElementBody el={el} />
        </div>
      ))}
      {/* 笔迹压在最上面，像真的画在拼贴上 */}
      <BoardStrokesLayer elements={elements.filter(isStroke)} />
    </div>
  );
}
