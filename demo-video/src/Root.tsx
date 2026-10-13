import React from "react";
import { Composition, Still } from "remotion";
import { Video } from "./Video";
import { Cover } from "./components/Cover";
import { VIDEO } from "./config.mjs";
import "./style.css";
export function Root() {
  return (
    <>
      <Composition
        id="MineradioDemo"
        component={Video}
        durationInFrames={VIDEO.frames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Still
        id="MineradioCover"
        component={Cover}
        width={VIDEO.width}
        height={VIDEO.height}
      />
    </>
  );
}
