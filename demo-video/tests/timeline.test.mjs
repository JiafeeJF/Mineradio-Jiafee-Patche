import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { VIDEO, SCENES, MOTION, AUDIO, COPY } from "../src/config.mjs";
test("Storyboard fills exactly 1050 frames without gaps or overlap", () => {
  assert.equal(VIDEO.seconds * VIDEO.fps, 1050);
  let cursor = 0;
  for (const s of SCENES) {
    assert.equal(s.start, cursor);
    assert.ok(s.end > s.start);
    assert.equal(((s.end - s.start) * VIDEO.fps) % 1, 0);
    cursor = s.end;
  }
  assert.equal(cursor, 35);
});
test("Message animation finishes before disconnect and leaves a readable hold", () => {
  const b = MOTION.bubble;
  assert.ok(b.hold >= 1.3);
  assert.ok(MOTION.message + b.grow + b.hold + b.shrink <= 33);
  assert.ok(b.scalePeak > 1);
  assert.ok(MOTION.expand < MOTION.message);
});
test("Audio event peaks are below music peak and fit the film", () => {
  assert.ok(AUDIO.clickPeak < AUDIO.musicPeak);
  assert.ok(AUDIO.messagePeak < AUDIO.musicPeak);
  assert.ok(MOTION.message + AUDIO.messageDuration < VIDEO.seconds);
  for (const t of AUDIO.clicks) assert.ok(t >= 0 && t < VIDEO.seconds);
});
test("Referenced preset names exist in the real payload", () => {
  const presets = JSON.parse(
    fs.readFileSync(
      new URL("../../payload/public/fx-presets.json", import.meta.url),
      "utf8",
    ),
  );
  for (const name of COPY.presetNames)
    assert.ok(
      presets.some((p) => p.name === name),
      name,
    );
});
