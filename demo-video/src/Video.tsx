import React from "react";
import { Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { VIDEO, SCENES, MOTION } from "./config.mjs";
import { ramp } from "./motion";
import { Stage } from "./components/Shared";
import { PatcherHome } from "./components/PatcherHome";
import { AudioEffectsDemo } from "./components/AudioEffectsDemo";
import { TogetherListenDemo } from "./components/TogetherListenDemo";
import { DisconnectRecovery } from "./components/DisconnectRecovery";
export function Video() {
  const t = useCurrentFrame() / VIDEO.fps;
  const audioStart = SCENES[4].start;
  const togetherStart = SCENES[5].start;
  const disconnectStart = SCENES[7].start;
  return (
    <Stage>
      <Audio src={staticFile("soundtrack.wav")} />
      <Sequence from={0} durationInFrames={audioStart * VIDEO.fps + 8}>
        <PatcherHome t={Math.min(t, audioStart)} />
      </Sequence>
      <Sequence
        from={audioStart * VIDEO.fps}
        durationInFrames={(togetherStart - audioStart) * VIDEO.fps + 8}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: ramp(t, audioStart, audioStart + MOTION.fade),
          }}
        >
          <AudioEffectsDemo t={Math.min(t, togetherStart)} />
        </div>
      </Sequence>
      <Sequence
        from={togetherStart * VIDEO.fps}
        durationInFrames={(disconnectStart - togetherStart) * VIDEO.fps}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: ramp(t, togetherStart, togetherStart + MOTION.fade),
          }}
        >
          <TogetherListenDemo t={t} />
        </div>
      </Sequence>
      <Sequence
        from={disconnectStart * VIDEO.fps}
        durationInFrames={(VIDEO.seconds - disconnectStart) * VIDEO.fps}
      >
        <DisconnectRecovery t={t} />
      </Sequence>
    </Stage>
  );
}
