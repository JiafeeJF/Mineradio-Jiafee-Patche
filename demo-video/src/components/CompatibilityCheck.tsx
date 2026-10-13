import React from "react";
import { Check, Folder, ShieldCheck } from "lucide-react";
import { COLORS as C, COPY as T, MOTION as M } from "../config.mjs";
import { ramp } from "../motion";
import { Button, card, row } from "./Shared";
export function CompatibilityCheck({ t }: { t: number }) {
  return (
    <>
      {t >= M.check && t < 13 && (
        <div
          style={{
            position: "absolute",
            left: 58,
            top: 635,
            width: 1130,
            ...card,
            padding: "18px 24px",
            display: "flex",
            flexWrap: "wrap",
            gap: "16px 28px",
          }}
        >
          {T.checks.map((s, i) => (
            <div
              key={s}
              style={{
                ...row,
                width: i < 3 ? 330 : 470,
                fontSize: 20,
                color: t >= M.checkSteps[i] ? C.mint : C.faint,
                opacity: ramp(
                  t,
                  M.checkSteps[i] - 0.1,
                  M.checkSteps[i] + 0.15,
                  0.35,
                  1,
                ),
              }}
            >
              <Check size={23} />
              {s}
            </div>
          ))}
        </div>
      )}
      {t >= M.choose && t < M.folderClose && (
        <div
          style={{
            position: "absolute",
            inset: 48,
            background: C.shade,
            display: "grid",
            placeItems: "center",
            zIndex: 20,
          }}
        >
          <div
            style={{
              ...card,
              width: 1400,
              padding: 38,
              background: C.panel,
              boxShadow: `0 25px 80px ${C.shade}`,
            }}
          >
            <div
              style={{
                ...row,
                fontSize: 27,
                fontWeight: 700,
                marginBottom: 28,
              }}
            >
              <Folder color={C.ice} />
              {T.folderTitle}
            </div>
            <div
              style={{
                ...card,
                padding: 20,
                fontSize: 23,
                whiteSpace: "nowrap",
                background: C.bg,
              }}
            >
              {T.target}
            </div>
            <div style={{ ...row, justifyContent: "flex-end", marginTop: 28 }}>
              <Button primary t={t} at={M.folderClose}>
                {T.confirm}
              </Button>
            </div>
          </div>
        </div>
      )}
      {t >= M.checkSteps[4] && t < 13 && (
        <div
          style={{
            position: "absolute",
            left: 1250,
            top: 495,
            ...row,
            color: C.mint,
            fontSize: 20,
          }}
        >
          <ShieldCheck size={23} />
          {T.checks[3]}
        </div>
      )}
    </>
  );
}
