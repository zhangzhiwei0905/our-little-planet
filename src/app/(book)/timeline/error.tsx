"use client";

/** 时间轴的错误边界：客户端渲染崩了也能看到具体报错，而不是无声的空白页 */
export default function TimelineError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card-paper mx-auto mt-16 flex max-w-md flex-col items-center gap-4 px-8 py-10 text-center">
      <p className="text-lg font-bold">这一页渲染出错了</p>
      <p className="break-all rounded-lg bg-rose-soft/60 px-3 py-2 font-round text-xs text-rose-deep">
        {error.message}
        {error.digest ? `（${error.digest}）` : ""}
      </p>
      <button type="button" onClick={reset} className="btn-primary">
        再试一次
      </button>
    </div>
  );
}
