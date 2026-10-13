import React from "react";
import { COLORS as C, COPY as T, MOTION as M } from "../config.mjs";
import { ramp } from "../motion";
import { PlayerBase, Button, Caption, Cursor, card, row } from "./Shared";
import { Presence } from "./TogetherListenDemo";
import { EndingFrame } from "./Cover";
export function DisconnectRecovery({ t }: { t: number }) {
  const cleared = t >= 33.55;
  return (
    <>
      <div style={{ opacity: ramp(t, 33.65, 34.1, 1, 0) }}>
        <PlayerBase t={t} empty={cleared} playing={!cleared} song={T.nextSong}>
          <Presence t={t} disconnect />
          <div
            style={{ position: "absolute", left: 850, top: 515, width: 700 }}
          >
            {T.queue.map((s, i) => (
              <div
                key={s}
                style={{
                  ...card,
                  marginBottom: 9,
                  padding: "9px 20px",
                  fontSize: 20,
                  color: C.muted,
                  opacity: ramp(t, 33.15 + i * 0.06, 33.4 + i * 0.06, 1, 0),
                }}
              >
                {s}
              </div>
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              right: 80,
              top: 744,
              opacity: ramp(t, 33.2, 33.6, 1, 0),
            }}
          >
            <Button danger t={t} at={M.disconnect}>
              {T.disconnect}
            </Button>
          </div>
          <div
            style={{
              position: "absolute",
              left: 36,
              right: 36,
              bottom: 28,
              height: 100,
              border: `1px solid ${C.ice}`,
              borderRadius: 8,
              opacity: Math.min(
                ramp(t, 33.35, 33.5, 0, 0.35),
                ramp(t, 33.5, 33.75, 0.35, 0),
              ),
            }}
          />
          <Caption sub={cleared ? T.cleared : T.members}>
            {cleared ? T.solo : T.togetherShort}
          </Caption>
        </PlayerBase>
      </div>
      <div
        style={{
          opacity: ramp(t, 33.65, 34.1),
          transform: `translateY(${ramp(t, 33.65, 34.1, 14, 0)}px)`,
        }}
      >
        <EndingFrame />
      </div>
      {t < 33.45 && (
        <Cursor
          t={t}
          clicks={[M.disconnect]}
          points={[
            [33, 1620, 844],
            [33.1, 1620, 844],
          ]}
          opacity={ramp(t, 33.2, 33.45, 1, 0)}
        />
      )}
    </>
  );
}
