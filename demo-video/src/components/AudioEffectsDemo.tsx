import React from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { COLORS as C, COPY as T, MOTION as M } from "../config.mjs";
import { ramp, enter } from "../motion";
import { PlayerBase, Caption, Cursor, Button, card, row } from "./Shared";
const EQ_VALUES = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [1.5, 1.5, 0.4, -0.8, -0.5, 0.3, 1, 1, 0.9, 1.2],
  [-2, -1.4, -1, -2, -0.6, 2, 2.4, 1.5, 0.2, 0.8],
  [1.3, 1.3, 0.6, -0.8, -0.2, 0.6, 0.6, 1, 1.2, 1.6],
];
export function AudioEffectsDemo({ t }: { t: number }) {
  const active =
    t < M.presets[0] ? 0 : t < M.presets[1] ? 1 : t < M.presets[2] ? 2 : 3;
  const opened = enter(t, M.fxOpen, 0.45);
  return (
    <>
      <PlayerBase t={t} progress={0.32 + (t - 17) * 0.004}>
        <div
          style={{
            position: "absolute",
            left: 910,
            top: 143,
            width: 710,
            height: 636,
            ...card,
            background: C.fx,
            padding: 24,
            opacity: ramp(t, M.fxOpen - 0.15, M.fxOpen + 0.15),
            transform: `translateY(${(1 - opened) * 16}px)`,
          }}
        >
          <div
            style={{
              ...row,
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <strong style={{ fontSize: 23 }}>{T.fxTitle}</strong>
            <span style={{ fontSize: 16, color: C.faint }}>{T.fxSource}</span>
          </div>
          <div style={{ display: "grid", gap: 7 }}>
            {T.presetNames.map((s, i) => (
              <div
                key={s}
                style={{
                  ...card,
                  ...row,
                  padding: "9px 16px",
                  height: 64,
                  justifyContent: "space-between",
                  background: active === i ? C.iceWash : C.card,
                  borderColor: active === i ? C.mint : C.border,
                }}
              >
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{s}</div>
                  <div style={{ fontSize: 15, color: C.muted }}>
                    {T.presetDetails[i]}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 15,
                    color: active === i ? C.mint : C.muted,
                    ...row,
                  }}
                >
                  {active === i && <Check size={19} />}
                  <span>{T.presetTags[i]}</span>
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              borderTop: `1px dashed ${C.border}`,
              marginTop: 17,
              paddingTop: 12,
            }}
          >
            <div
              style={{ ...row, justifyContent: "space-between", fontSize: 20 }}
            >
              <strong>{T.eq}</strong>
              <span style={{ ...row, fontSize: 16, color: C.ice }}>
                {T.enabled}
                <span
                  style={{
                    width: 40,
                    height: 22,
                    borderRadius: 8,
                    background: C.ice,
                    display: "flex",
                    justifyContent: "flex-end",
                    padding: 3,
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: C.text,
                    }}
                  />
                </span>
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "35px repeat(10,1fr)",
                height: 177,
                marginTop: 12,
                ...card,
                padding: "12px 10px",
                position: "relative",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  height: 124,
                  fontSize: 13,
                  color: C.faint,
                }}
              >
                {T.eqScale.map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
              {T.eqBands.map((label, i) => {
                const previous = EQ_VALUES[Math.max(0, active - 1)][i];
                const current = EQ_VALUES[active][i];
                const start = active ? M.presets[active - 1] : 17;
                const value = ramp(t, start, start + 0.45, previous, current);
                const beat =
                  ramp((t + i * 0.09) % 1.46, 0, 0.73, 0, 2) -
                  ramp((t + i * 0.09) % 1.46, 0.73, 1.46, 0, 2);
                return (
                  <div
                    key={label}
                    style={{
                      textAlign: "center",
                      fontSize: 14,
                      color: C.muted,
                    }}
                  >
                    <div style={{ position: "relative", height: 124 }}>
                      <div
                        style={{
                          position: "absolute",
                          left: "50%",
                          width: 3,
                          height: 124,
                          background: C.border,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: 62 - value * 4 - beat,
                          width: 20,
                          height: 12,
                          borderRadius: 4,
                          transform: "translate(-50%,-50%)",
                          background: C.text,
                          border: `1px solid ${C.ice}`,
                        }}
                      />
                    </div>
                    <div style={{ marginTop: 7 }}>{label}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 10,
              fontSize: 14,
              color: C.faint,
            }}
          >
            <span>{T.eqNote}</span>
            <span>
              {T.resetEq}　{T.saveEq}
            </span>
          </div>
        </div>
        <Caption sub={T.originalPlayer}>{T.fxChain}</Caption>
      </PlayerBase>
      <Cursor
        t={t}
        clicks={[M.fxOpen, ...M.presets]}
        points={[
          [17, 1500, 920],
          [17.35, 1670, 920],
          [17.6, 1170, 397],
          [17.65, 1170, 397],
          [18.3, 1180, 472],
          [18.65, 1180, 472],
          [19.65, 1180, 540],
          [20.1, 1180, 540],
          [21.3, 1470, 670],
        ]}
      />
    </>
  );
}
