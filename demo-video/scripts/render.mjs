import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import {
  selectComposition,
  renderMedia,
  renderStill,
  openBrowser,
} from "@remotion/renderer";
import { generateAudio } from "./audio.mjs";
import { QA_FRAMES, VIDEO } from "../src/config.mjs";
import { findBrowser } from "./browser.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
fs.mkdirSync(out, { recursive: true });
generateAudio();
const browserExecutable = findBrowser();
const browser = await openBrowser("chrome", { browserExecutable });
try {
  const serveUrl = await bundle({
    entryPoint: path.join(root, "src/index.ts"),
    publicDir: path.join(root, "public"),
  });
  const common = { serveUrl, browserInstance: browser, browserExecutable };
  const composition = await selectComposition({
    ...common,
    id: "MineradioDemo",
  });
  if (process.argv.includes("--stills")) {
    fs.mkdirSync(path.join(out, "frames"), { recursive: true });
    for (const frame of QA_FRAMES) {
      await renderStill({
        ...common,
        composition,
        frame,
        output: path.join(
          out,
          "frames",
          `${String(frame).padStart(4, "0")}.png`,
        ),
      });
      console.log("Frame", frame);
    }
  } else if (!process.argv.includes("--cover")) {
    let last = -1;
    await renderMedia({
      ...common,
      composition,
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      crf: 18,
      concurrency: Math.min(4, Number(process.env.REMOTION_CONCURRENCY) || 4),
      outputLocation: path.join(out, "Mineradio-JIAFEE-2.2.9.mp4"),
      onProgress: ({ progress }) => {
        const p = Math.floor(progress * 100);
        if (p >= last + 5) {
          last = p;
          console.log(`Render ${p}%`);
        }
      },
    });
  }
  const cover = await selectComposition({ ...common, id: "MineradioCover" });
  await renderStill({
    ...common,
    composition: cover,
    output: path.join(out, "Mineradio-JIAFEE-2.2.9-cover.png"),
  });
  fs.writeFileSync(
    path.join(out, "render-settings.json"),
    JSON.stringify(
      {
        ...VIDEO,
        codec: "h264",
        audioCodec: "aac",
        pixelFormat: "yuv420p",
        crf: 18,
        remotion: "4.0.535",
      },
      null,
      2,
    ),
  );
  console.log("Done:", out);
} finally {
  await browser.close({ silent: true });
}
