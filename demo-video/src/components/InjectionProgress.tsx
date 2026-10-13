import React from "react";
import { Check, ShieldCheck } from "lucide-react";
import { COLORS as C, COPY as T, MOTION as M } from "../config.mjs";
import { ramp } from "../motion";
import { card, row } from "./Shared";
export function InjectionProgress({ t }: { t: number }) {
  const progress = ramp(t, 13, 16.35);
  return (
    <div
      style={{
        position: "absolute",
        left: 58,
        top: 635,
        width: 1130,
        ...card,
        padding: "14px 24px",
        height: 210,
      }}
    >
      <div
        style={{
          ...row,
          fontSize: 18,
          color: C.muted,
          justifyContent: "space-between",
        }}
      >
        <span>{t < M.done ? T.backup : T.verified}</span>
        <span style={{ color: C.mint }}>
          {Math.round(progress * 100)}
          {T.pct}
        </span>
      </div>
      <div
        style={{
          height: 4,
          background: C.border,
          margin: "12px 0 14px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            background: C.mint,
          }}
        />
        <div
          style={{
            position: "absolute",
            height: 4,
            width: 100,
            top: 0,
            left: `${progress * 100 - 8}%`,
            background: `linear-gradient(90deg,transparent,${C.ice},transparent)`,
          }}
        />
      </div>
      <div style={{ height: 112, overflow: "hidden", position: "relative" }}>
        <div
          style={{ transform: `translateY(${-ramp(t, 14.8, 15.9, 0, 84)}px)` }}
        >
          {T.logs.map((s, i) => (
            <div
              key={s}
              style={{
                ...row,
                height: 28,
                fontSize: 18,
                color: C.muted,
                opacity: ramp(t, M.logs[i], M.logs[i] + 0.2),
                transform: `translateX(${ramp(t, M.logs[i], M.logs[i] + 0.2, 8, 0)}px)`,
              }}
            >
              <Check size={17} color={C.mint} />
              {s}
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 1250,
          top: -260,
          width: 320,
          opacity: ramp(t, 16.05, 16.4),
        }}
      >
        <ShieldCheck size={46} color={C.mint} />
        <div
          style={{
            fontSize: 27,
            marginTop: 20,
            fontWeight: 700,
            color: C.mint,
          }}
        >
          {T.verified}
        </div>
        <div style={{ fontSize: 24, color: C.text, marginTop: 14 }}>
          {T.success}
        </div>
      </div>
    </div>
  );
}
