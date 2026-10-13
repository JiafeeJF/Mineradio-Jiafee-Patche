import React from "react";
import { Folder, ShieldCheck } from "lucide-react";
import { COLORS as C, COPY as T, MOTION as M } from "../config.mjs";
import { ramp, enter } from "../motion";
import { Window, Button, Tick, Note, Cursor, card, row } from "./Shared";
import { CompatibilityCheck } from "./CompatibilityCheck";
import { InjectionProgress } from "./InjectionProgress";
export function PatcherHome({
  t,
  ending = false,
}: {
  t: number;
  ending?: boolean;
}) {
  const demo = ending ? 16.8 : t;
  const hasTarget = demo >= M.folderClose;
  const modules = [demo >= M.fxCheck, demo >= M.togetherCheck];
  const reveal = enter(t, M.windowEnter[0], 1);
  return (
    <>
      <Window
        title={T.product}
        style={{
          opacity: ending ? 1 : ramp(t, 2.7, 3.2),
          transform: `translateY(${ending ? 0 : (1 - reveal) * 32}px)`,
        }}
      >
        <div style={{ position: "absolute", left: 58, top: 80 }}>
          <div style={{ fontSize: 34, fontWeight: 900 }}>{T.product}</div>
          <div
            style={{
              fontSize: 17,
              color: C.mint,
              fontWeight: 700,
              marginTop: 3,
            }}
          >
            {T.developer}
          </div>
          <div style={{ fontSize: 20, color: C.muted, marginTop: 9 }}>
            {T.description}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: 52,
            top: 90,
            ...card,
            padding: "9px 14px",
            fontSize: 17,
            color: C.muted,
          }}
        >
          {T.badge}
        </div>
        <div
          style={{
            ...card,
            position: "absolute",
            left: 58,
            top: 225,
            width: 1130,
            padding: 22,
          }}
        >
          <div style={{ color: C.muted, fontSize: 20, marginBottom: 12 }}>
            {T.moduleLabel}
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
          >
            {[T.fx, T.together].map((s, i) => (
              <div
                key={s}
                style={{
                  ...card,
                  ...row,
                  alignItems: "flex-start",
                  gap: 14,
                  padding: 18,
                  borderColor: modules[i] ? C.mint : C.border,
                  background: modules[i] ? C.mintWash : C.card,
                  transform: `scale(${1 + ramp(demo, i ? M.togetherCheck : M.fxCheck, (i ? M.togetherCheck : M.fxCheck) + 0.12, 0, 0.007) - ramp(demo, (i ? M.togetherCheck : M.fxCheck) + 0.12, (i ? M.togetherCheck : M.fxCheck) + 0.3, 0, 0.007)})`,
                }}
              >
                <Tick checked={modules[i]} />
                <div>
                  <strong style={{ fontSize: 23 }}>{s}</strong>
                  <div
                    style={{
                      fontSize: 17,
                      color: C.muted,
                      marginTop: 6,
                      lineHeight: 1.5,
                    }}
                  >
                    {i ? T.togetherDetail : T.fxDetail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div
          data-qa="source-status"
          style={{
            ...card,
            position: "absolute",
            left: 58,
            top: 405,
            width: 1130,
            height: 158,
            padding: "16px 22px",
            display: "grid",
            gridTemplateColumns: "116px 1fr",
            gap: "3px 12px",
            fontSize: 17,
            lineHeight: 1.25,
          }}
        >
          {T.labels.map((label, i) => (
            <React.Fragment key={label}>
              <span style={{ color: C.muted }}>{label}</span>
              <span
                style={{
                  color: i === 3 ? C.mint : C.text,
                  whiteSpace: "nowrap",
                  fontSize: i === 0 ? 18 : 17,
                }}
              >
                {
                  [
                    hasTarget ? T.target : T.pending,
                    hasTarget ? T.target : T.empty,
                    hasTarget ? T.sourceVersion : T.empty,
                    demo >= M.done
                      ? T.installed
                      : hasTarget
                        ? T.ready
                        : T.pending,
                    demo >= 11.7 ? T.checkPass : T.checkWait,
                  ][i]
                }
              </span>
            </React.Fragment>
          ))}
        </div>
        <div
          data-qa="patch-actions"
          style={{ position: "absolute", left: 58, top: 575, ...row, gap: 9 }}
        >
          <Button t={demo} at={M.choose}>
            <Folder size={18} />
            {T.choose}
          </Button>
          <Button t={demo} at={M.check}>
            {T.check}
          </Button>
          <Button primary t={demo} at={M.inject}>
            {T.inject}
          </Button>
          <Button danger>{T.uninstall}</Button>
          <Button>{T.open}</Button>
        </div>
        {demo < M.check && (
          <div
            style={{
              position: "absolute",
              left: 58,
              top: 635,
              width: 1130,
              ...card,
              padding: 24,
              color: C.muted,
              fontSize: 19,
            }}
          >
            {T.preparing}
          </div>
        )}
        {demo >= 13 ? (
          <InjectionProgress t={demo} />
        ) : (
          <CompatibilityCheck t={demo} />
        )}
        <div
          style={{
            position: "absolute",
            left: 60,
            bottom: 24,
            color: C.faint,
            fontSize: 16,
            width: 1120,
          }}
        >
          {T.patcherNote}
        </div>
        {demo < 13 && (
          <Note
            title={demo < 8 ? T.independent : T.checks[0]}
            lines={demo < 8 ? [T.combined] : [T.transaction]}
            style={{
              left: 1250,
              top: 260,
              opacity: ramp(demo, M.moduleNote, M.moduleNote + 0.5),
            }}
          />
        )}
      </Window>
      {t < 3.2 && !ending && (
        <div
          style={{
            position: "absolute",
            left: ramp(t, 2.4, 3.2, 310, 168),
            top: ramp(t, 2.4, 3.2, 412, 160),
            opacity: ramp(t, 3, 3.2, 1, 0),
          }}
        >
          <div
            aria-label={T.product}
            style={{
              fontWeight: 900,
              fontSize: ramp(t, 2.4, 3.2, 62, 34),
              whiteSpace: "nowrap",
            }}
          >
            {[...T.product].map((char, i) => (
              <span
                aria-hidden
                key={i}
                style={{ opacity: ramp(t, 0.4 + i * 0.067, 0.52 + i * 0.067) }}
              >
                {char}
              </span>
            ))}
          </div>
          <div
            style={{
              color: C.mint,
              fontSize: 24,
              marginTop: 20,
              opacity: ramp(t, 1.5, 2),
            }}
          >
            {T.developer}
          </div>
        </div>
      )}
      {t < 3 && !ending && (
        <>
          <div
            style={{
              position: "absolute",
              right: 150,
              top: 100,
              color: C.muted,
              fontSize: 20,
              opacity: ramp(t, 1.5, 2.4),
            }}
          >
            {T.badge}
          </div>
          <div
            style={{
              position: "absolute",
              left: ramp(t, 0.1, 2.1, 100, 1800),
              top: 520,
              width: 110,
              height: 1,
              background: C.mint,
              opacity: Math.min(ramp(t, 0.1, 0.3), ramp(t, 2.1, 2.4, 1, 0)),
            }}
          />
        </>
      )}
      {!ending && t >= 3 && t < 13 && (
        <Cursor
          t={t}
          clicks={[
            M.fxCheck,
            M.togetherCheck,
            M.choose,
            M.folderClose,
            M.check,
            M.inject,
          ]}
          points={[
            [3, 1450, 860],
            [3.8, 223, 405],
            [4.35, 223, 405],
            [4.9, 774, 405],
            [5.5, 774, 405],
            [7.6, 880, 680],
            [8.2, 290, 678],
            [8.55, 1550, 628],
            [9.1, 1550, 628],
            [9.4, 465, 678],
            [11.9, 635, 678],
            [12.55, 635, 678],
          ]}
        />
      )}
    </>
  );
}
