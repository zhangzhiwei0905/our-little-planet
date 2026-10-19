import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import sharp from "sharp";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();

// Match the existing component tests: compile locally without changing build output.
function loadSource(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const record = { exports: {} };
  cache.set(filename, record);
  const js = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const localRequire = createRequire(filename);
  const require_ = (name) => {
    if (!name.startsWith("@/") && !name.startsWith(".")) return localRequire(name);
    const base = name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : path.resolve(path.dirname(filename), name);
    const source = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate));
    assert.ok(source, `Missing import: ${name}`);
    return loadSource(source);
  };
  new Function("require", "module", "exports", js)(require_, record, record.exports);
  return record.exports;
}

const { prepareQuickFiles, QuickInputError, QUICK_MAX_BYTES } = loadSource(path.join(root, "src/lib/quick-files.ts"));
const file = (name, mime = name.endsWith(".mov") ? "video/quicktime" : "image/jpeg") => ({
  name, mime, buf: Buffer.from("fixture"),
});
const archive = (members, name = "batch.zip") => ({
  name, mime: "application/zip", buf: Buffer.from(zipSync(members)),
});
const bytes = new Uint8Array([1, 2, 3]);
const inputError = (status) => (error) => error instanceof QuickInputError && error.status === status;

test("mixed ZIP keeps static photos, Live pairs, and independent videos in order", () => {
  const plan = prepareQuickFiles([archive({
    "item-1.jpg": bytes, "item-2.jpg": bytes, "item-2.mov": bytes, "clip-3.mp4": bytes,
  })]);
  assert.deepEqual(plan.map((item) => item.file.name), ["item-1.jpg", "item-2.jpg", "clip-3.mp4"]);
  assert.equal(plan[1].liveVideo.name, "item-2.mov");
});

test("nine Live Photos count as nine items, not eighteen files", () => {
  const files = Array.from({ length: 9 }, (_, index) => [
    file(`item-${index}.jpg`), file(`item-${index}.mov`),
  ]).flat();
  assert.equal(prepareQuickFiles(files).length, 9);
  const members = Object.fromEntries(files.map((item) => [item.name, bytes]));
  assert.equal(prepareQuickFiles([archive(members)]).length, 9);
});

test("ten independent photos are rejected", () => {
  assert.throws(() => prepareQuickFiles(Array.from({ length: 10 }, (_, i) => file(`item-${i}.jpg`))), inputError(400));
});

test("expanded file count is bounded", () => {
  const members = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`item-${i}.jpg`, bytes]));
  assert.throws(() => prepareQuickFiles([archive(members)]), inputError(400));
});

test("ambiguous Live names are rejected rather than paired arbitrarily", () => {
  assert.throws(() => prepareQuickFiles([file("same.jpg"), file("same.png"), file("same.mov")]), inputError(400));
});

test("pairing is case-insensitive and works when video is listed first", () => {
  const plan = prepareQuickFiles([file("ITEM.MOV", "video/quicktime"), file("item.jpg")]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].liveVideo.name, "ITEM.MOV");
});

test("archive folders do not cross-pair files from different folders", () => {
  const plan = prepareQuickFiles([archive({ "a/IMG.jpg": bytes, "b/IMG.mov": bytes })]);
  assert.equal(plan.length, 2);
});

test("livp keeps the legacy archive-basename pairing", () => {
  const plan = prepareQuickFiles([archive({ "original.HEIC": bytes, "different.MOV": bytes, "metadata.json": bytes }, "item-1.livp")]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].file.name, "item-1.heic");
  assert.equal(plan[0].liveVideo.name, "item-1.mov");
});

test("Mac metadata and hidden entries are ignored", () => {
  const plan = prepareQuickFiles([archive({
    "__MACOSX/._item.jpg": bytes, ".DS_Store": bytes, "folder/.hidden": bytes, "item.jpg": bytes,
  })]);
  assert.equal(plan.length, 1);
});

test("non-media files and nested archives are rejected", () => {
  assert.throws(() => prepareQuickFiles([archive({ "notes.txt": bytes })]), inputError(415));
  assert.throws(() => prepareQuickFiles([archive({ "nested.zip": bytes })]), inputError(415));
});

test("corrupt, empty, and empty-media archives are rejected", () => {
  assert.throws(() => prepareQuickFiles([{ ...file("bad.zip"), mime: "application/zip" }]), inputError(400));
  assert.throws(() => prepareQuickFiles([archive({})]), inputError(400));
  assert.throws(() => prepareQuickFiles([archive({ "empty.jpg": new Uint8Array() })]), inputError(400));
});

test("oversized declared archive size is rejected before decompression", () => {
  const input = archive({ "item.jpg": bytes });
  const central = input.buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central >= 0);
  input.buf.writeUInt32LE(QUICK_MAX_BYTES + 1, central + 24);
  assert.throws(() => prepareQuickFiles([input]), inputError(413));
});

test("aggregate input sizes are bounded without allocating huge fixtures", () => {
  assert.throws(() => prepareQuickFiles([
    { name: "a.jpg", mime: "image/jpeg", buf: { byteLength: QUICK_MAX_BYTES } },
    { name: "b.jpg", mime: "image/jpeg", buf: { byteLength: 1 } },
  ]), inputError(413));
});

test("a later archive observes the remaining decompression budget", () => {
  const input = archive({ "item.jpg": bytes });
  const central = input.buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  input.buf.writeUInt32LE(QUICK_MAX_BYTES, central + 24);
  assert.throws(() => prepareQuickFiles([file("first.jpg"), input]), inputError(413));
});

// Import the actual route after changing cwd, so its SQLite database and files are disposable.
const originalCwd = process.cwd();
const sandbox = await mkdtemp(path.join(os.tmpdir(), "planet-quick-test-"));
process.chdir(sandbox);
for (const key of ["OSS_BUCKET", "OSS_ENDPOINT", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET"]) delete process.env[key];
process.env.SHORTCUT_TOKEN = "test-only-shortcut-token";
const { POST } = loadSource(path.join(root, "src/app/api/quick/route.ts"));
const { db, MEDIA_DIR } = loadSource(path.join(root, "src/lib/db.ts"));
const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#c03b55" } }).jpeg().toBuffer();
const videoPath = path.join(sandbox, "fixture.mp4");
execFileSync(process.env.FFMPEG_PATH || "ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=32x32:r=10",
  "-t", "0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath,
]);
const video = readFileSync(videoPath);
// 快捷指令的「录音」动作产出 m4a，这里用 ffmpeg 造一段 1.5 秒的正弦波当夹具
const audioPath = path.join(sandbox, "fixture.m4a");
execFileSync(process.env.FFMPEG_PATH || "ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5",
  "-c:a", "aac", "-f", "ipod", audioPath,
]);
const audio = readFileSync(audioPath);
const batch = archive({
  "item-1.jpg": jpeg, "item-2.jpg": jpeg, "item-2.mp4": video, "clip-3.mp4": video,
});

function request(type, fields = {}, files = []) {
  const form = new FormData();
  form.set("type", type);
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  files.forEach((item, index) => form.append(`file${index}`, new Blob([item.buf], { type: item.mime }), item.name));
  return new Request("http://localhost/api/quick", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.SHORTCUT_TOKEN}` }, body: form,
  });
}

// 照 iOS 快捷指令的样子发录音：字段名是配置里写的 `audio`，
// 文件名常常整个缺失（FormData 默认叫 "blob"），Content-Type 也可能是空的。
function quoteRequest(fields, { mime = "", filename } = {}) {
  const form = new FormData();
  form.set("type", "quote");
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const blob = new Blob([audio], { type: mime });
  if (filename === undefined) form.append("audio", blob);
  else form.append("audio", blob, filename);
  return new Request("http://localhost/api/quick", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.SHORTCUT_TOKEN}` }, body: form,
  });
}

function mediaOf(entryId) {
  return db.prepare("SELECT kind, mime, filename, duration FROM media WHERE entry_id = ?").all(entryId);
}

test("journal batch creates exactly one entry with three ordered media items", async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM entries").get().n;
  const response = await POST(request("journal", { text: "batch test", date: "2026-09-30" }, [batch]));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mediaCount, 3);
  assert.equal(result.path, "/journal");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM entries").get().n, before + 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media WHERE entry_id = ?").get(result.id).n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media WHERE entry_id = ? AND live_video_id IS NOT NULL").get(result.id).n, 1);
});

test("photo batch creates only an album entry and accepts empty text", async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM entries WHERE type = 'journal'").get().n;
  const response = await POST(request("photo", {}, [batch]));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.type, "photo");
  assert.equal(result.path, "/album");
  assert.equal(result.mediaCount, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM entries WHERE type = 'journal'").get().n, before);
});

test("legacy direct photo/video form still creates one Live Photo", async () => {
  const response = await POST(request("journal", { text: "legacy" }, [
    { name: "live-test.jpg", mime: "image/jpeg", buf: jpeg },
    { name: "live-test.mp4", mime: "video/mp4", buf: video },
  ]));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mediaCount, 1);
});

test("legacy quote JSON still works", async () => {
  const response = await POST(new Request("http://localhost/api/quick", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.SHORTCUT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "quote", text: "test quote" }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).path, "/quotes");
});

test("quote mode 1: clipboard text only creates one entry without media", async () => {
  const response = await POST(request("quote", { text: "只贴文字", speaker: "她说" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.path, "/quotes");
  assert.equal(result.mediaCount, 0);
  assert.deepEqual(mediaOf(result.id), []);
  const entry = db.prepare("SELECT body, speaker, type FROM entries WHERE id = ?").get(result.id);
  assert.deepEqual(entry, { body: "只贴文字", speaker: "她说", type: "quote" });
});

test("quote mode 2: audio only stores one voice note with its duration", async () => {
  const response = await POST(quoteRequest({ speaker: "我说" }, { mime: "audio/x-m4a", filename: "录音.m4a" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mediaCount, 1);
  const [media] = mediaOf(result.id);
  assert.equal(media.kind, "audio");
  // 声明可信时原样保留（audio/x-m4a），扩展名照样落到 .m4a
  assert.ok(/^audio\//.test(media.mime), media.mime);
  assert.ok(/\.m4a$/.test(media.filename), media.filename);
  assert.ok(media.duration >= 1 && media.duration <= 3, `duration=${media.duration}`);
  assert.equal(db.prepare("SELECT body FROM entries WHERE id = ?").get(result.id).body, "");
});

test("quote mode 3: text plus audio stays a single entry", async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM entries").get().n;
  const response = await POST(quoteRequest({ text: "文字加录音", speaker: "她说" }, { mime: "audio/mp4", filename: "both.m4a" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mediaCount, 1);
  const [media] = mediaOf(result.id);
  assert.equal(media.kind, "audio");
  assert.ok(media.duration > 0, `duration=${media.duration}`);
  const entry = db.prepare("SELECT body, speaker FROM entries WHERE id = ?").get(result.id);
  assert.deepEqual(entry, { body: "文字加录音", speaker: "她说" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM entries").get().n, before + 1);
});

test("nameless recording from Shortcuts is stored as audio, not as a photo", async () => {
  for (const mime of ["", "application/octet-stream"]) {
    const response = await POST(quoteRequest({ text: "没有文件名的录音", speaker: "我说" }, { mime }));
    assert.equal(response.status, 200);
    const result = await response.json();
    const [media] = mediaOf(result.id);
    assert.equal(media.kind, "audio", `声明 mime="${mime}" 时被存成了 ${media.kind}`);
    assert.ok(/\.m4a$/.test(media.filename), media.filename);
    assert.ok(media.duration > 0, `duration=${media.duration}`);
  }
});

test("quote speaker defaults to 她说 and audio-only album uploads are still rejected", async () => {
  const response = await POST(quoteRequest({}, { mime: "audio/mp4", filename: "no-speaker.m4a" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(db.prepare("SELECT speaker FROM entries WHERE id = ?").get(result.id).speaker, "她说");
  assert.equal((await POST(request("photo", {}, [{ name: "voice.m4a", mime: "audio/mp4", buf: audio }]))).status, 415);
});

test("album requires media and rejects audio-only uploads", async () => {
  assert.equal((await POST(request("photo", { text: "no media" }))).status, 400);
  assert.equal((await POST(request("photo", {}, [{ name: "audio.mp3", mime: "audio/mpeg", buf: bytes }]))).status, 415);
});

test("invalid batches fail before any media or entries are stored", async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM media").get().n;
  const response = await POST(request("photo", {}, [archive({ "notes.txt": bytes })]));
  assert.equal(response.status, 415);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media").get().n, before);
});

test("token authentication and request size checks still apply", async () => {
  const unauthorized = request("photo", {}, [batch]);
  unauthorized.headers.set("Authorization", "Bearer incorrect");
  assert.equal((await POST(unauthorized)).status, 401);
  const oversized = request("photo", {}, [batch]);
  oversized.headers.set("Content-Length", String(QUICK_MAX_BYTES + 2 * 1024 * 1024));
  assert.equal((await POST(oversized)).status, 413);
});

after(async () => {
  // 录音不生成缩略图/封面（media.ts 只对 photo/video 补图），不要等它
  const rows = db.prepare("SELECT id, kind FROM media WHERE kind IN ('photo', 'video')").all();
  // Wait for the actual async thumbnail/poster work before removing the test directory.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const done = rows.every((row) => existsSync(path.join(MEDIA_DIR, row.kind === "photo" ? `${row.id}_thumb.webp` : `${row.id}_poster.jpg`)));
    if (done) break;
    if (attempt === 99) throw new Error("Timed out waiting for thumbnails/posters");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  db.close();
  process.chdir(originalCwd);
  await rm(sandbox, { recursive: true, force: true });
});
