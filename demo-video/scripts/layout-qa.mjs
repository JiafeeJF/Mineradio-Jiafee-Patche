import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { openBrowser } from "@remotion/renderer";
import { findBrowser } from "./browser.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(root, ".cache"), { recursive: true });
const output = path.join(root, ".cache/layout-entry.cjs");
await build({
  entryPoints: [path.join(root, "tests/layout-entry.tsx")],
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  outfile: output,
});
const { markup, playbackState } = await import(pathToFileURL(output));
assert.equal(
  playbackState(25.5).progress,
  playbackState(26).progress,
  "Pause must stop progression",
);
assert.notEqual(
  playbackState(26).song,
  playbackState(27.1).song,
  "Next track must change metadata",
);
const browser = await openBrowser("chrome", {
  browserExecutable: findBrowser(),
});
const report = [];
try {
  const page = await browser.newPage({
    context: () => null,
    logLevel: "error",
    indent: false,
    pageIndex: 0,
    onBrowserLog: null,
    onLog: () => {},
  });
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  let avatarReference;
  const samples = [
    7, 8.7, 11.7, 16.6, 19.5, 22.7, 23.5, 25.5, 29, 29.25, 29.5, 29.9, 30.5,
    31.5, 32, 32.7, 33.6, 34.9,
  ];
  for (const t of samples) {
    await page.evaluate((html) => {
      document.documentElement.innerHTML = `<head><style>*{box-sizing:border-box}body{margin:0}</style></head><body>${html}</body>`;
    }, markup(t));
    const state = await page.evaluate(() => {
      const rect = (q) => {
        const el = document.querySelector(`[data-qa="${q}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          bottom: r.bottom,
          right: r.right,
          opacity: parseFloat(getComputedStyle(el).opacity),
        };
      };
      const wide = [...document.querySelectorAll("span,strong")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.left < 0 || r.right > 1920);
        })
        .map((el) => el.textContent);
      return {
        avatar: rect("peer-avatar-slot"),
        input: rect("chat-input"),
        bubble: rect("chat-bubble"),
        status: rect("source-status"),
        actions: rect("patch-actions"),
        wide,
      };
    });
    assert.deepEqual(state.wide, [], `Text outside the frame at ${t}`);
    if (t < 17 && state.status && state.actions)
      assert.ok(
        state.status.bottom < state.actions.y,
        `Status overlaps actions at ${t}`,
      );
    if (t >= 29 && t < 33) {
      avatarReference ??= state.avatar;
      assert.deepEqual(state.avatar, avatarReference, `Avatar moved at ${t}`);
      if (state.bubble.opacity > 0.95)
        assert.ok(
          state.bubble.bottom < state.input.y,
          `Bubble overlaps input at ${t}`,
        );
    }
    report.push({ time: t, ...state });
  }
  await page.evaluate(
    (html) => {
      document.body.innerHTML = html;
    },
    markup(30.5, "这首真的很好听，我们再听一遍！"),
  );
  const multi = await page.evaluate(() => {
    const a = document
      .querySelector('[data-qa="peer-avatar-slot"]')
      .getBoundingClientRect();
    const b = document
      .querySelector('[data-qa="chat-bubble"]')
      .getBoundingClientRect();
    const i = document
      .querySelector('[data-qa="chat-input"]')
      .getBoundingClientRect();
    return {
      avatar: { x: a.x, y: a.y, width: a.width, height: a.height },
      bubbleBottom: b.bottom,
      inputTop: i.y,
    };
  });
  assert.equal(multi.avatar.x, avatarReference.x);
  assert.equal(multi.avatar.y, avatarReference.y);
  assert.equal(multi.avatar.width, avatarReference.width);
  assert.equal(multi.avatar.height, avatarReference.height);
  assert.ok(
    multi.bubbleBottom < multi.inputTop,
    "Multiline bubble overlaps input",
  );
  fs.mkdirSync(path.join(root, "out"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "out/layout-report.json"),
    JSON.stringify(
      { passed: true, samples: report, multiline: multi },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${samples.length} browser layout samples; fixed avatar bounds; single/multiline bubble clearance; pause and track metadata.`,
  );
} finally {
  await browser.close({ silent: true });
}
