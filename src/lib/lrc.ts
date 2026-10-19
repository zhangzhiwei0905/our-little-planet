/** LRC 歌词解析（大事记背景音乐用）。
 *  支持一行多个时间标签（[00:12.00][00:45.20]副歌重复）、[mm:ss] / [mm:ss.xx] / [mm:ss.xxx]，
 *  元数据标签（[ti:] [ar:] [offset:] 等）直接忽略；全文没有时间标签时当纯文本歌词，
 *  播放器退化为信纸排版、不做逐行跟唱。 */

export type LrcLine = { time: number | null; text: string };

export type Lrc = { lines: LrcLine[]; synced: boolean };

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(src: string): Lrc {
  const out: LrcLine[] = [];
  let synced = false;
  for (const raw of src.split(/\r?\n/)) {
    const tags = [...raw.matchAll(TIME_TAG)];
    const text = raw.replace(TIME_TAG, "").trim();
    if (tags.length === 0) {
      // [ti:歌名] 这类元数据丢掉；空行丢掉；剩下的当无时间行保留（间奏独白、翻译）
      if (/^\[[a-zA-Z]{2,4}:/.test(raw) || !text) continue;
      out.push({ time: null, text });
      continue;
    }
    synced = true;
    for (const m of tags) {
      const fracRaw = m[3] ?? "";
      const frac = fracRaw ? Number(fracRaw) / 10 ** fracRaw.length : 0;
      out.push({ time: Number(m[1]) * 60 + Number(m[2]) + frac, text });
    }
  }
  if (synced) out.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  return { lines: out, synced };
}
