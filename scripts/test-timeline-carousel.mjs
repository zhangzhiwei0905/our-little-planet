import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "@phosphor-icons/react";
import * as motion from "motion/react";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();

// Compile TSX in this test process without adding a runtime dependency or build step.
function loadComponent(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const moduleRecord = { exports: {} };
  cache.set(filename, moduleRecord);
  const localRequire = createRequire(filename);
  const resolve = (name) => {
    if (name === "@phosphor-icons/react") return icons;
    if (name === "motion/react") return motion;
    if (!name.startsWith("@/") && !name.startsWith(".")) return localRequire(name);
    const base = name.startsWith("@/")
      ? path.join(root, "src", name.slice(2))
      : path.resolve(path.dirname(filename), name);
    const source = [base, `${base}.tsx`, `${base}.ts`].find((file) => existsSync(file));
    assert.ok(source, `Missing import: ${name}`);
    return loadComponent(source);
  };
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  new Function("require", "module", "exports", outputText)(resolve, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

const { MilestoneMedia } = loadComponent(path.join(root, "src/components/timeline/MilestoneMedia.tsx"));
const { PolaroidCard } = loadComponent(path.join(root, "src/components/journal/PolaroidCard.tsx"));
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
const photo = {
  id: "photo", url: "/photo.jpg", kind: "photo", width: 1600, height: 900,
  caption: null, thumbUrl: null, posterUrl: null, liveVideo: null,
};
const variants = [
  photo,
  { ...photo, id: "portrait", width: 900, height: 1600, caption: "Long caption ".repeat(50) },
  { ...photo, id: "square", width: 1000, height: 1000 },
  { ...photo, id: "unknown", width: null, height: null },
  { ...photo, id: "video", kind: "video", url: "/video.mp4", caption: "Video" },
];

test("every carousel slide uses the same fixed stage and out-of-flow animation", () => {
  for (const active of variants) {
    const html = render(MilestoneMedia, { media: [active, ...variants.filter((m) => m.id !== active.id)], entryDate: "2026-09-23", tone: "rose" });
    assert.match(html, /class="relative overflow-hidden aspect-\[3\/4\] w-full"/);
    assert.match(html, /class="absolute inset-0 p-2"/);
    assert.match(html, /object-contain/);
    assert.match(html, /h-\[4\.375rem\] shrink-0 overflow-hidden/);
    assert.match(html, /aria-label="上一个"/);
    assert.match(html, /aria-label="下一个"/);
  }
});

test("fixed photo frames ignore intrinsic dimensions and reserve empty captions", () => {
  const markup = variants.filter((m) => m.kind === "photo").map((m) =>
    render(PolaroidCard, { src: "/photo.jpg", width: m.width, height: m.height, fixedFrame: true, tape: "none" })
  );
  for (const html of markup) {
    assert.equal(html, markup[0]);
    assert.doesNotMatch(html, /aspect-ratio/);
    assert.match(html, /min-h-0 flex-1/);
    assert.match(html, /h-\[4\.375rem\] shrink-0 overflow-hidden/);
  }
});

test("single photos retain their natural aspect ratio and have no carousel controls", () => {
  const html = render(MilestoneMedia, { media: [photo], entryDate: "2026-09-23", tone: "rose" });
  assert.match(html, /aspect-ratio:1600 \/ 900/);
  assert.doesNotMatch(html, /aspect-\[3\/4\]|absolute inset-0 p-2|aria-label="下一个"|h-\[4\.375rem\]/);
});

test("other PolaroidCard callers retain their existing layout by default", () => {
  const html = render(PolaroidCard, { src: "/photo.jpg", width: 900, height: 1600 });
  assert.match(html, /aspect-ratio:900 \/ 1600/);
  assert.match(html, /object-cover/);
  assert.doesNotMatch(html, /h-\[4\.375rem\]/);
});
