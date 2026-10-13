import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Stage, Window } from "../src/components/Shared";
import { PatcherHome } from "../src/components/PatcherHome";
import { AudioEffectsDemo } from "../src/components/AudioEffectsDemo";
import {
  TogetherListenDemo,
  Presence,
} from "../src/components/TogetherListenDemo";
import { DisconnectRecovery } from "../src/components/DisconnectRecovery";
import { playbackState } from "../src/motion";
export { playbackState };
export function markup(t: number, message?: string) {
  return renderToStaticMarkup(
    <Stage>
      {message ? (
        <Window>
          <Presence t={t} message={message} />
        </Window>
      ) : t < 17 ? (
        <PatcherHome t={t} />
      ) : t < 22 ? (
        <AudioEffectsDemo t={t} />
      ) : t < 33 ? (
        <TogetherListenDemo t={t} />
      ) : (
        <DisconnectRecovery t={t} />
      )}
    </Stage>,
  );
}
