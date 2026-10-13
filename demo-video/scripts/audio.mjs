import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIO as A, VIDEO, MOTION } from "../src/config.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Original procedural lo-fi arrangement. No downloaded samples or copyrighted recordings.
export function generateAudio() {
  const rate = A.rate,
    n = rate * VIDEO.seconds,
    left = new Float64Array(n),
    right = new Float64Array(n);
  const musicL = new Float64Array(n),
    musicR = new Float64Array(n),
    fx = new Float64Array(n);
  const beat = 60 / A.bpm,
    bar = beat * 4,
    TAU = Math.PI * 2;
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  let seed = 2209;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  const chords = [
    [48, 55, 58, 63],
    [44, 51, 55, 60],
    [51, 58, 62, 65],
    [46, 53, 56, 60],
  ];
  function add(track, start, duration, fn) {
    const begin = Math.round(start * rate);
    const count = Math.min(Math.round(duration * rate), n - begin);
    for (let j = 0; j < count; j++) {
      if (begin + j >= 0) track[begin + j] += fn(j / rate, j);
    }
  }
  for (
    let barIndex = 0;
    barIndex < Math.ceil(VIDEO.seconds / bar);
    barIndex++
  ) {
    const start = barIndex * bar,
      chord = chords[barIndex % 4];
    chord.forEach((note, k) => {
      for (const [track, detune, pan] of [
        [musicL, 0.999, 1 - k * 0.06],
        [musicR, 1.001, 0.8 + k * 0.05],
      ])
        add(track, start, bar + 0.4, (t) => {
          const env =
            Math.min(1, t / 0.045) *
            Math.exp(-t / 2.2) *
            Math.min(1, (bar + 0.4 - t) / 0.25);
          const f = hz(note + 12) * detune;
          return (
            0.025 *
            pan *
            env *
            (Math.sin(TAU * f * t) + 0.17 * Math.sin(TAU * f * 2 * t))
          );
        });
    });
    for (let b = 0; b < 4; b++) {
      const at = start + b * beat;
      for (const track of [musicL, musicR]) {
        add(
          track,
          at,
          0.45,
          (t) =>
            0.065 *
            Math.sin(TAU * (48 * t + 2 * (1 - Math.exp(-t * 32)))) *
            Math.exp(-t * 15),
        );
        add(
          track,
          at,
          0.6,
          (t) =>
            0.045 *
            Math.sin(TAU * hz(chord[0] - 12) * t) *
            Math.min(1, t / 0.015) *
            Math.exp(-t * 5),
        );
        if (b % 2)
          add(
            track,
            at,
            0.16,
            (t) =>
              0.014 * noise() * Math.exp(-t * 33) +
              0.012 * Math.sin(TAU * 160 * t) * Math.exp(-t * 28),
          );
        for (let half = 0; half < 2; half++)
          add(
            track,
            at + half * beat * 0.54,
            0.055,
            (t) => 0.005 * noise() * Math.exp(-t * 95),
          );
      }
      if (b === 0 || b === 2) {
        const note = hz(chord[(barIndex + b) % 4] + 24);
        for (const track of [musicL, musicR])
          add(
            track,
            at + beat * 0.5,
            0.7,
            (t) =>
              0.009 *
              Math.sin(TAU * note * t) *
              Math.min(1, t / 0.012) *
              Math.exp(-t * 7),
          );
      }
    }
  }
  // One global music gain preserves dynamics. UI peaks remain below the music peak.
  let rawPeak = 0;
  for (let i = 0; i < n; i++)
    rawPeak = Math.max(rawPeak, Math.abs(musicL[i]), Math.abs(musicR[i]));
  const gain = A.musicPeak / rawPeak;
  for (const at of A.clicks)
    add(
      fx,
      at,
      0.07,
      (t) =>
        A.clickPeak *
        Math.sin(TAU * 340 * t) *
        Math.sin((Math.PI * t) / 0.07) ** 2 *
        Math.exp(-t * 24),
    );
  add(fx, MOTION.message, A.messageDuration, (t) => {
    const slope = (A.messageHz[1] - A.messageHz[0]) / A.messageDuration;
    return (
      A.messagePeak *
      Math.sin(TAU * (A.messageHz[0] * t + 0.5 * slope * t * t)) *
      Math.sin((Math.PI * t) / A.messageDuration) ** 2
    );
  });
  let peak = 0,
    energy = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const fade = Math.min(1, t / 0.75, Math.max(0, VIDEO.seconds - t));
    left[i] = musicL[i] * gain * fade + fx[i];
    right[i] = musicR[i] * gain * fade + fx[i];
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    energy += left[i] ** 2 + right[i] ** 2;
  }
  function wav(name, l, r) {
    const buf = Buffer.alloc(44 + n * 4);
    buf.write("RIFF");
    buf.writeUInt32LE(buf.length - 8, 4);
    buf.write("WAVEfmt ", 8);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(2, 22);
    buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * 4, 28);
    buf.writeUInt16LE(4, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) {
      buf.writeInt16LE(
        Math.round(Math.max(-1, Math.min(1, l[i])) * 32767),
        44 + i * 4,
      );
      buf.writeInt16LE(
        Math.round(Math.max(-1, Math.min(1, r[i])) * 32767),
        46 + i * 4,
      );
    }
    fs.writeFileSync(path.join(root, "public", name), buf);
  }
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  wav("soundtrack.wav", left, right);
  const report = {
    seconds: VIDEO.seconds,
    sampleRate: rate,
    channels: 2,
    peakDb: 20 * Math.log10(peak),
    rmsDb: 20 * Math.log10(Math.sqrt(energy / (n * 2))),
    musicPeak: A.musicPeak,
    clickPeak: A.clickPeak,
    messagePeak: A.messagePeak,
    originalProceduralAudio: true,
  };
  fs.mkdirSync(path.join(root, "out"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "out/audio-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("Audio:", report);
  return report;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) generateAudio();
