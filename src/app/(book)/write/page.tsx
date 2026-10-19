import type { Metadata } from "next";
import { isAuthor } from "@/lib/auth";
import { recordGuestVisitFor } from "@/lib/visitors";
import { listEntries, listAlbum } from "@/lib/entries";
import { getSettings } from "@/lib/settings";
import { listEggs, doodleCounts } from "@/lib/eggs";
import { listMilestones } from "@/lib/milestones";
import { PenGate } from "@/components/write/PenGate";
import { WriteDashboard } from "@/components/write/WriteDashboard";
import { listAllTags } from "@/lib/tagStore";

export const metadata: Metadata = { title: "写手账" };

export default async function WritePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await recordGuestVisitFor("/write");
  if (!(await isAuthor())) return <PenGate />;
  // searchParams 在服务端读好传进去（客户端不再 useSearchParams，水合更稳）
  const sp = await searchParams;
  const FILTER_KEYS = ["all", "journal", "photo", "quote", "letter", "milestone", "egg"];
  const initialFilter = typeof sp.filter === "string" && FILTER_KEYS.includes(sp.filter) ? sp.filter : undefined;
  const [entries, settings, eggs, milestones, album] = [
    listEntries({ includeDrafts: true }),
    getSettings(),
    listEggs(),
    listMilestones(),
    // 后台的按张管理和「从本子里选」要看得到孤儿（放映室专用的视频/封面、
    // 还没保存的草稿都在这里管理），读者看得到的墙上则永远不出现
    listAlbum({ includeOrphans: true }),
  ];
  return (
    <WriteDashboard
      initialType={typeof sp.type === "string" ? sp.type : undefined}
      initialTab={typeof sp.tab === "string" ? sp.tab : undefined}
      editId={typeof sp.edit === "string" ? sp.edit : undefined}
      allTags={listAllTags()}
      initialFilter={initialFilter}
      initialEntries={entries}
      settings={settings}
      initialEggs={eggs.map((e) => {
        const counts = doodleCounts(e.id);
        const rec: Record<string, number> = {};
        for (const [k, v] of counts) rec[k] = v;
        return { id: e.id, title: e.title, password: e.password, revealDate: e.revealDate, letter: e.letter, photoIds: e.photoIds, doodles: rec };
      })}
      initialMilestones={milestones.map((m) => ({
        id: m.id,
        title: m.title,
        body: m.body,
        date: m.date,
        icon: m.icon,
        mediaIds: m.media.map((x) => x.id),
        visibility: m.visibility,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      }))}
      album={album.map((p) => ({
        id: p.id,
        url: p.url,
        thumbUrl: p.thumbUrl,
        posterUrl: p.posterUrl,
        caption: p.caption,
        kind: p.kind,
        mime: p.mime,
        width: p.width,
        height: p.height,
        liveVideo: p.liveVideo,
        hevc: p.hevc,
        entryDate: p.entryDate,
        tags: p.tags,
        createdAt: p.createdAt,
      }))}
    />
  );
}
