import React from "react";
import { Check, SlidersHorizontal, Users } from "lucide-react";
import { COLORS as C, COPY as T } from "../config.mjs";
import { PatcherHome } from "./PatcherHome";
import { Stage, card, row } from "./Shared";
// Shared by frame 1049 and the standalone 1920x1080 cover composition.
export function EndingFrame() {
  return (
    <>
      <PatcherHome t={35} ending />
      <div
        style={{
          position: "absolute",
          left: 110,
          top: 128,
          width: 1700,
          height: 872,
          background: "rgba(16,17,20,.93)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <div style={{ fontSize: 24, color: C.muted, marginBottom: 28 }}>
          {T.product}
        </div>
        <div style={{ fontSize: 55, fontWeight: 800, letterSpacing: -1 }}>
          {T.ending}
        </div>
        <div style={{ ...row, gap: 20, marginTop: 36 }}>
          {[
            [T.fx, SlidersHorizontal],
            [T.together, Users],
          ].map(([label, Icon], i) => {
            const I = Icon as typeof Users;
            return (
              <div
                key={i}
                style={{
                  ...card,
                  ...row,
                  padding: "12px 22px",
                  fontSize: 22,
                  color: C.ice,
                }}
              >
                <I size={23} />
                {label as string}
                <Check size={21} color={C.mint} />
              </div>
            );
          })}
        </div>
        <div
          style={{
            fontSize: 24,
            color: C.mint,
            fontWeight: 700,
            marginTop: 52,
          }}
        >
          {T.developer}
        </div>
        <div style={{ fontSize: 19, color: C.muted, marginTop: 12 }}>
          {T.version}
        </div>
      </div>
    </>
  );
}
export function Cover() {
  return (
    <Stage>
      <EndingFrame />
    </Stage>
  );
}
