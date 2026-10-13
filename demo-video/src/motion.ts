import { interpolate, spring } from "remotion";
import { MOTION, VIDEO, COPY, TRACK_SECONDS } from "./config.mjs";
export const ramp = (t: number, a: number, b: number, from = 0, to = 1) =>
  interpolate(t, [a, b], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
export const ease = (t: number, a: number, b: number) => {
  const p = ramp(t, a, b);
  return interpolate(p, [0, 0.15, 0.5, 0.85, 1], [0, 0.06, 0.5, 0.94, 1]);
};
export const enter = (t: number, start: number, duration = 0.65) =>
  spring({
    frame: Math.max(0, (t - start) * VIDEO.fps),
    fps: VIDEO.fps,
    durationInFrames: Math.round(duration * VIDEO.fps),
    config: { damping: 22, stiffness: 120, mass: 0.9 },
  });
export const press = (t: number, at: number) =>
  interpolate(t, [at - 0.06, at, at + MOTION.press], [1, 0.975, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
export const lerpPoints = (t: number, points: number[][]) => ({
  x: interpolate(
    t,
    points.map((p) => p[0]),
    points.map((p) => p[1]),
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  ),
  y: interpolate(
    t,
    points.map((p) => p[0]),
    points.map((p) => p[2]),
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  ),
});
export function bubbleState(t: number) {
  const age = t - MOTION.message;
  const b = MOTION.bubble;
  const finish = b.grow + b.hold + b.shrink;
  return {
    opacity: Math.min(
      ramp(age, 0, 0.12),
      ramp(age, finish - b.fade, finish, 1, 0),
    ),
    scale: interpolate(
      age,
      [0, b.grow, b.grow + b.hold, finish],
      [b.scaleStart, b.scalePeak, b.scalePeak, b.scaleEnd],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    ),
    space: interpolate(
      age,
      [0, 0.12, b.grow + b.hold, finish, finish + 0.3],
      [0, 64, 64, 48, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    ),
  };
}
export function playbackState(t: number) {
  const M = MOTION;
  const playing = t >= M.play && !(t >= M.pause && t < M.resume);
  const elapsed =
    Math.max(0, t - M.play) - ramp(t, M.pause, M.resume, 0, M.resume - M.pause);
  const progress =
    t < M.next
      ? 0.32 + elapsed / TRACK_SECONDS
      : 0.08 +
        (t - M.next) / TRACK_SECONDS +
        ramp(t, M.seek[0], M.seek[1], 0, 0.24);
  return { playing, progress, song: t >= M.next ? COPY.nextSong : COPY.song };
}
