import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import * as icons from "@phosphor-icons/react";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cache = new Map();

/** 和 test-timeline-carousel 同一套路：进程内编译 TSX，不引构建步骤 */
function loadComponent(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const moduleRecord = { exports: {} };
  cache.set(filename, moduleRecord);
  const source = readFileSync(filename, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const localRequire = createRequire(filename);
  const module_ = { exports: moduleRecord.exports };
  const run = new Function("require", "module", "exports", "__filename", "__dirname", js);
  const req = (name) => {
    if (name === "@phosphor-icons/react") return icons;
    if (!name.startsWith("@/") && !name.startsWith(".")) return localRequire(name);
    const base = name.startsWith("@/")
      ? path.join(root, "src", name.slice(2))
      : path.resolve(path.dirname(filename), name);
    const file = [base, `${base}.tsx`, `${base}.ts`].find((f) => existsSync(f));
    assert.ok(file, `Missing import: ${name}`);
    return loadComponent(file);
  };
  run(req, module_, moduleRecord.exports, filename, path.dirname(filename));
  return moduleRecord.exports;
}

const pickerFile = path.join(root, "src/components/write/MediaPicker.tsx");
const { MediaPicker } = loadComponent(pickerFile);

const items = [
  { id: "a1", url: "u1", thumbUrl: "t1", caption: null, kind: "photo", entryDate: "2026-05-20", tags: ["海"] },
  { id: "a2", url: "u2", thumbUrl: "t2", caption: null, kind: "photo", entryDate: "2026-05-21", tags: [] },
  { id: "a3", url: "u3", thumbUrl: "t3", caption: null, kind: "photo", entryDate: "2026-08-23", tags: ["夏", "海"] },
  { id: "a4", url: "u4", thumbUrl: "t4", caption: null, kind: "video", entryDate: "2026-08-23", tags: ["夏"] },
  { id: "a5", url: "u5", thumbUrl: "t5", caption: null, kind: "photo", entryDate: "2026-08-24", tags: [] },
];

test("默认态：月份/类型/标签筛选都在，计数正确", () => {
  const html = renderToStaticMarkup(
    createElement(MediaPicker, {
      items,
      selected: ["a3"],
      onToggle: () => {},
      emptyHint: "空的",
    })
  );
  const text = html.replace(/<[^>]+>/g, " ");
  assert.ok(html.includes("2026 年 5 月"), "应有 5 月筛选");
  assert.ok(html.includes("2026 年 8 月"), "应有 8 月筛选");
  assert.ok(/全部\s*5/.test(text), "全部 = 5");
  assert.ok(/照片\s*4/.test(text), "照片 = 4");
  assert.ok(/视频\s*1/.test(text), "视频 = 1");
  assert.ok(/海\s*2/.test(text) && /夏\s*2/.test(text), "标签计数");
  assert.ok(!text.includes("当前筛选下只看得到"), "没被筛掉的选中项不提示");
  assert.ok(html.includes('aria-pressed="true"'), "选中态渲染");
});

test("items 为空：显示空提示，不出筛选条", () => {
  const html = renderToStaticMarkup(
    createElement(MediaPicker, { items: [], selected: [], onToggle: () => {}, emptyHint: "本子还空着" })
  );
  assert.ok(html.includes("本子还空着"));
  assert.ok(!html.includes("全部标签"));
});
