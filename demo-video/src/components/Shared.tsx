import React from "react";
import {
  Check,
  Minus,
  Square,
  X,
  MousePointer2,
  Music2,
  Search,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  ListMusic,
  SlidersHorizontal,
  Users,
  ArrowRight,
} from "lucide-react";
import {
  COLORS as C,
  COPY as T,
  FONT,
  MOTION,
  TRACK_SECONDS,
} from "../config.mjs";
import { ramp, press, lerpPoints } from "../motion";
export const card: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  background: C.card,
};
export const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};
export function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: C.desktop,
        color: C.text,
        fontFamily: FONT,
        fontSize: 22,
        lineHeight: 1.5,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </div>
  );
}
export function Window({
  children,
  title = T.app,
  style = {},
}: {
  children: React.ReactNode;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 110,
        top: 80,
        width: 1700,
        height: 920,
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: `0 30px 70px ${C.shade}`,
        ...style,
      }}
    >
      <div
        style={{
          height: 48,
          padding: "0 24px",
          ...row,
          borderBottom: `1px solid ${C.border}`,
          fontSize: 16,
          color: C.muted,
        }}
      >
        <Music2 size={18} color={C.mint} />
        <span>{title}</span>
        <div style={{ marginLeft: "auto", ...row, gap: 26 }}>
          <Minus size={16} />
          <Square size={14} />
          <X size={17} />
        </div>
      </div>
      {children}
    </div>
  );
}
export function Button({
  children,
  primary = false,
  danger = false,
  t = 0,
  at = -10,
  style = {},
}: {
  children: React.ReactNode;
  primary?: boolean;
  danger?: boolean;
  t?: number;
  at?: number;
  style?: React.CSSProperties;
}) {
  const hover = Math.abs(t - at) < 0.35;
  return (
    <div
      style={{
        ...row,
        justifyContent: "center",
        height: 46,
        padding: "0 16px",
        borderRadius: 8,
        border: `1px solid ${danger ? C.red : primary ? C.mint : C.border}`,
        background: danger
          ? "rgba(255,139,139,.1)"
          : primary
            ? C.mintWash
            : hover
              ? C.iceWash
              : C.card,
        color: danger ? C.red : C.text,
        fontSize: 19,
        fontWeight: 650,
        whiteSpace: "nowrap",
        transform: `scale(${press(t, at)})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
export function Tick({
  checked,
  size = 25,
}: {
  checked: boolean;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        borderRadius: 4,
        border: `1px solid ${checked ? C.mint : C.faint}`,
        background: checked ? C.mint : "transparent",
        color: C.bg,
      }}
    >
      {checked && <Check size={size - 5} strokeWidth={3} />}
    </div>
  );
}
export function Cursor({
  t,
  points,
  clicks = [],
  opacity = 1,
}: {
  t: number;
  points: number[][];
  clicks?: number[];
  opacity?: number;
}) {
  const p = lerpPoints(t, points);
  const at = clicks.find((x) => Math.abs(x - t) < 0.25) ?? -10;
  return (
    <div
      style={{
        position: "absolute",
        left: p.x,
        top: p.y,
        zIndex: 100,
        pointerEvents: "none",
        opacity,
        transform: `scale(${press(t, at)})`,
        filter: `drop-shadow(0 2px 3px ${C.shade})`,
      }}
    >
      <MousePointer2 size={32} fill={C.white} color={C.bg} strokeWidth={1.8} />
    </div>
  );
}
export function Note({
  title,
  lines = [],
  icon = true,
  style = {},
}: {
  title: string;
  lines?: string[];
  icon?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 1320,
        top: 300,
        width: 340,
        ...style,
      }}
    >
      {icon && (
        <div
          style={{ width: 42, height: 3, background: C.mint, marginBottom: 24 }}
        />
      )}
      <div
        style={{
          fontSize: 30,
          lineHeight: 1.45,
          fontWeight: 700,
          color: C.text,
        }}
      >
        {title}
      </div>
      {lines.map((x, i) => (
        <div
          key={i}
          style={{
            fontSize: 23,
            lineHeight: 1.7,
            color: C.muted,
            marginTop: 18,
          }}
        >
          {x}
        </div>
      ))}
    </div>
  );
}
export function Caption({
  children,
  sub,
}: {
  children: React.ReactNode;
  sub?: string;
}) {
  return (
    <div style={{ position: "absolute", left: 70, bottom: 148, maxWidth: 750 }}>
      <div style={{ ...row, color: C.mint, fontWeight: 650, fontSize: 28 }}>
        <ArrowRight size={24} />
        {children}
      </div>
      {sub && (
        <div style={{ marginTop: 8, color: C.muted, fontSize: 20 }}>{sub}</div>
      )}
    </div>
  );
}
export function PlayerBar({
  t,
  playing = true,
  empty = false,
  song = T.song,
  progress = 0.32,
  compact = false,
}: {
  t: number;
  playing?: boolean;
  empty?: boolean;
  song?: string;
  progress?: number;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        position: compact ? "relative" : "absolute",
        left: compact ? undefined : 36,
        right: compact ? undefined : 36,
        bottom: compact ? undefined : 28,
        height: compact ? 145 : 100,
        borderTop: `1px solid ${C.border}`,
        background: C.bg,
        padding: compact ? "18px 20px" : "22px 22px",
        display: "flex",
        alignItems: "center",
        gap: 26,
        flexWrap: compact ? "wrap" : "nowrap",
      }}
    >
      <div style={{ ...row, width: compact ? "100%" : 355, gap: 16 }}>
        <div
          style={{
            ...card,
            width: 48,
            height: 48,
            display: "grid",
            placeItems: "center",
            color: C.ice,
          }}
        >
          <Music2 size={25} />
        </div>
        <div>
          <div style={{ fontSize: compact ? 20 : 22, fontWeight: 600 }}>
            {empty ? T.soloReady : song}
          </div>
          <div style={{ fontSize: 15, color: C.muted }}>
            {empty ? T.empty : T.artist}
          </div>
        </div>
      </div>
      <div style={{ ...row, gap: 18 }}>
        <SkipBack size={22} />
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: C.text,
            color: C.bg,
          }}
        >
          {playing && !empty ? (
            <Pause size={22} fill={C.bg} />
          ) : (
            <Play size={21} fill={C.bg} />
          )}
        </div>
        <SkipForward size={22} />
      </div>
      <div
        style={{
          flex: 1,
          minWidth: compact ? 170 : 300,
          ...row,
          gap: 12,
          fontSize: 14,
          color: C.muted,
        }}
      >
        <span>
          {empty
            ? T.zero
            : `${String(Math.floor((progress * TRACK_SECONDS) / 60)).padStart(2, "0")}:${String(Math.floor(progress * TRACK_SECONDS) % 60).padStart(2, "0")}`}
        </span>
        <div
          style={{
            flex: 1,
            height: 3,
            background: C.border,
            position: "relative",
          }}
        >
          <div
            style={{
              width: `${empty ? 0 : progress * 100}%`,
              height: 3,
              background: C.ice,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${empty ? 0 : progress * 100}%`,
              top: -4,
              width: 11,
              height: 11,
              borderRadius: "50%",
              background: C.text,
            }}
          />
        </div>
        <span>{empty ? T.zero : T.total}</span>
      </div>
      {!compact && (
        <>
          <Volume2 size={24} color={C.muted} />
          <span style={{ fontSize: 16, color: C.muted }}>{T.quality}</span>
          <div
            style={{
              ...card,
              padding: "5px 12px",
              fontSize: 17,
              color: C.ice,
              ...row,
              gap: 7,
            }}
          >
            <SlidersHorizontal size={17} />
            {T.fxTitle}
          </div>
          <ListMusic size={24} color={C.muted} />
        </>
      )}
    </div>
  );
}
export function PlayerBase({
  children,
  t,
  playing = true,
  empty = false,
  song = T.song,
  progress = 0.32,
  showLyrics = true,
}: {
  children?: React.ReactNode;
  t: number;
  playing?: boolean;
  empty?: boolean;
  song?: string;
  progress?: number;
  showLyrics?: boolean;
}) {
  return (
    <Window>
      <div
        style={{
          position: "absolute",
          left: 56,
          top: 76,
          ...row,
          color: C.muted,
          fontSize: 17,
        }}
      >
        <Search size={20} />
        {T.search}
      </div>
      <div style={{ position: "absolute", right: 54, top: 68 }}>
        <Button style={{ height: 36, fontSize: 16 }}>
          <Users size={17} />
          {T.togetherShort}
        </Button>
      </div>
      <div style={{ position: "absolute", left: 70, top: 225 }}>
        <div
          style={{
            color: C.faint,
            fontSize: 16,
            letterSpacing: 5,
            marginBottom: 24,
          }}
        >
          {T.app.toUpperCase()}
        </div>
        <div style={{ fontSize: 40, fontWeight: 650, marginBottom: 16 }}>
          {empty ? T.waiting : song}
        </div>
        <div style={{ color: C.muted, fontSize: 20 }}>
          {empty ? T.waitingHint : T.artist}
        </div>
        {showLyrics && !empty && (
          <div
            style={{
              color: C.faint,
              fontSize: 27,
              lineHeight: 2.1,
              marginTop: 64,
            }}
          >
            {T.lyrics.map((s, i) => (
              <div key={s} style={{ color: i ? C.faint : C.ice }}>
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
      <PlayerBar
        t={t}
        playing={playing}
        empty={empty}
        song={song}
        progress={progress}
      />
      {children}
    </Window>
  );
}
