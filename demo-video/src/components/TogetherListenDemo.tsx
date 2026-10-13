import React from "react";
import { Users, Send, Wifi, Check, ArrowRight } from "lucide-react";
import { COLORS as C, COPY as T, MOTION as M } from "../config.mjs";
import { ramp, ease, bubbleState, playbackState } from "../motion";
import {
  PlayerBase,
  PlayerBar,
  Button,
  Caption,
  Cursor,
  card,
  row,
} from "./Shared";
import { ChatBubble } from "./ChatBubble";
export function Presence({
  t,
  disconnect = false,
  message = T.message,
}: {
  t: number;
  disconnect?: boolean;
  message?: string;
}) {
  const b = bubbleState(t);
  const reserved =
    b.space * (1 + Math.max(0, Math.ceil((message.length + 2) / 7) - 1) * 0.7);
  const collapsed =
    ramp(t, M.collapse, M.collapse + 0.25) - ramp(t, M.expand, M.expand + 0.25);
  const leg = M.ballLeg;
  const phase = (t - M.connected) % (leg * 2);
  const dot = phase < leg ? ease(phase, 0, leg) : 1 - ease(phase, leg, 2 * leg);
  return (
    <div
      data-qa="presence"
      style={{
        position: "absolute",
        left: 1000,
        top: 150,
        width: 450,
        height: 330,
        opacity: disconnect ? ramp(t, 33.15, 33.6, 1, 0) : ramp(t, 24, 24.4),
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "156px 120px 156px",
          justifyContent: "center",
          alignItems: "start",
        }}
      >
        {[0, 1, 2].map((i) =>
          i === 1 ? (
            <div key={i} style={{ position: "relative", height: 96 }}>
              <div
                style={{
                  position: "absolute",
                  left: -10,
                  right: -10,
                  height: 1,
                  top: 48,
                  background: C.ice,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 43,
                  left: -10 + dot * 130,
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: C.ice,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 46,
                  top: 29,
                  fontSize: 26,
                  color: C.ice,
                  background: C.bg,
                  padding: "0 5px",
                }}
              >
                ♪
              </div>
            </div>
          ) : (
            <div
              key={i}
              data-qa={i ? "peer-avatar-slot" : "local-avatar-slot"}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                width: 156,
                height: 172,
              }}
            >
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: "50%",
                  background: i ? C.peerAvatar : C.avatar,
                  border: `1px solid ${C.border}`,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 28,
                  fontWeight: 650,
                }}
              >
                {i ? T.peerName : T.myName}
              </div>
              <strong style={{ fontSize: 21 }}>{i ? T.peer : T.local}</strong>
              <span style={{ fontSize: 16, color: C.mint }}>{T.connected}</span>
              {i === 2 && <ChatBubble t={t} text={message} />}
            </div>
          ),
        )}
      </div>
      <div
        data-qa="chat-input"
        style={{
          position: "absolute",
          top: 186 + reserved,
          left: 0,
          width: 450,
          ...row,
          gap: 10,
          justifyContent: "center",
        }}
      >
        <div
          style={{
            color: C.muted,
            fontSize: 27,
            width: 34,
            textAlign: "center",
          }}
        >
          {collapsed > 0.5 ? T.expand : T.collapse}
        </div>
        <div
          style={{
            ...row,
            gap: 15,
            width: 360 * (1 - collapsed),
            opacity: 1 - collapsed,
            overflow: "hidden",
            whiteSpace: "nowrap",
            height: 46,
            borderBottom: `1px solid ${C.border}`,
            fontSize: 20,
            color: C.muted,
          }}
        >
          <span style={{ flex: 1 }}>{T.chatPlaceholder}</span>
          <Send color={C.mint} size={23} />
        </div>
      </div>
    </div>
  );
}
function Lobby({ t }: { t: number }) {
  const remote = t >= M.remote[0];
  return (
    <div
      style={{
        position: "absolute",
        left: 470,
        top: 80,
        width: 900,
        ...card,
        padding: 20,
        background: C.glass,
        boxShadow: `0 24px 64px ${C.shade}`,
        opacity: Math.min(ramp(t, 22, 22.25), ramp(t, 23.9, 24.25, 1, 0)),
        transform: `translateY(${ramp(t, 22, 22.3, 10, 0)}px)`,
      }}
    >
      <div
        style={{
          ...row,
          justifyContent: "space-between",
          paddingBottom: 14,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div>
          <strong style={{ fontSize: 28 }}>{T.togetherShort}</strong>
          <div style={{ fontSize: 16, color: C.muted }}>{T.lobby}</div>
        </div>
        <Users color={C.ice} />
      </div>
      <div style={{ ...card, marginTop: 14, padding: 18 }}>
        <div style={{ fontSize: 20, fontWeight: 650 }}>{T.profile}</div>
        <div style={{ ...row, marginTop: 8, fontSize: 17, color: C.muted }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: C.avatar,
              display: "grid",
              placeItems: "center",
              color: C.text,
            }}
          >
            {T.myName}
          </div>
          {T.name}
          <span style={{ ...card, padding: "4px 18px", color: C.text }}>
            {T.myName}
          </span>
          <span style={{ marginLeft: "auto" }}>{T.save}</span>
        </div>
      </div>
      <div style={{ ...card, marginTop: 12, padding: 18 }}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <strong style={{ fontSize: 20 }}>{T.create}</strong>
          <Button style={{ height: 32, fontSize: 16 }}>{T.createButton}</Button>
        </div>
        <div style={{ fontSize: 16, color: C.muted, marginTop: 7 }}>
          {T.serverName}　　TCP　{T.port}
        </div>
      </div>
      <div
        style={{
          ...card,
          marginTop: 12,
          padding: 18,
          borderColor: remote ? C.border : C.mint,
        }}
      >
        <div style={{ ...row, justifyContent: "space-between", fontSize: 20 }}>
          <strong>{T.lan}</strong>
          <span style={{ fontSize: 16, color: C.muted }}>{T.refresh}</span>
        </div>
        <div style={{ ...row, marginTop: 10 }}>
          <Wifi color={C.mint} size={20} />
          <span style={{ fontSize: 18 }}>{T.lanAddress}</span>
          <Button
            primary
            t={t}
            at={M.lanJoin}
            style={{ marginLeft: "auto", height: 34, fontSize: 16 }}
          >
            {T.lanJoin}
          </Button>
        </div>
      </div>
      <div
        style={{
          ...card,
          marginTop: 12,
          padding: 18,
          borderColor: remote ? C.ice : C.border,
        }}
      >
        <strong style={{ fontSize: 20 }}>{T.direct}</strong>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.15fr 1fr",
            gap: 16,
            marginTop: 8,
          }}
        >
          <div>
            <div style={{ fontSize: 15, color: C.muted, marginBottom: 6 }}>
              {T.remoteHint}
            </div>
            <div style={{ ...card, padding: 10, fontSize: 18 }}>
              {remote ? T.remoteAddress : T.lanAddress}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 15, color: C.muted, marginBottom: 6 }}>
              {T.authLabel}
            </div>
            <div
              style={{
                ...card,
                padding: 10,
                fontSize: 18,
                color: remote ? C.ice : C.faint,
                letterSpacing: remote ? 8 : 0,
              }}
            >
              {remote ? T.auth : T.empty}
            </div>
          </div>
        </div>
        <div style={{ ...row, marginTop: 10 }}>
          <Button primary style={{ height: 35, fontSize: 16 }}>
            {T.join}
          </Button>
          <Button style={{ height: 35, fontSize: 16 }}>{T.saveAddress}</Button>
        </div>
      </div>
    </div>
  );
}
export function TogetherListenDemo({ t }: { t: number }) {
  const connected = t >= 24;
  const chat = t >= 29;
  const { playing, song, progress } = playbackState(t);
  return (
    <>
      <PlayerBase
        t={t}
        playing={playing}
        empty={t < 24.65 && connected}
        song={song}
        progress={progress}
        showLyrics={!connected || chat}
      >
        {!connected && <Lobby t={t} />}
        {connected && (
          <>
            <Presence t={t} />
            {!chat && (
              <div
                style={{
                  position: "absolute",
                  left: 70,
                  top: 475,
                  width: 1550,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 35,
                  opacity: ramp(t, 24.2, 24.65),
                }}
              >
                {[T.local, T.peer].map((s, i) => (
                  <div key={s} style={{ ...card, overflow: "hidden" }}>
                    <div
                      style={{
                        ...row,
                        padding: "13px 20px",
                        fontSize: 17,
                        color: C.muted,
                        justifyContent: "space-between",
                      }}
                    >
                      <span>
                        {s} · {T.demoCompare}
                      </span>
                      <span style={{ color: C.mint }}>
                        {playing ? T.playing : T.paused}
                      </span>
                    </div>
                    <PlayerBar
                      compact
                      t={t}
                      playing={playing}
                      empty={t < M.play}
                      song={song}
                      progress={progress}
                    />
                  </div>
                ))}
              </div>
            )}
            <div style={{ position: "absolute", right: 80, top: 744 }}>
              <Button danger>{T.disconnect}</Button>
            </div>
          </>
        )}
        <Caption sub={chat ? T.chatDetail : connected ? T.members : undefined}>
          {chat
            ? T.chatCaption
            : connected
              ? T.syncCaption
              : t >= 23
                ? T.remoteCaption
                : T.lanCaption}
        </Caption>
      </PlayerBase>
      <Cursor
        t={t}
        clicks={[
          M.lanJoin,
          M.play,
          M.pause,
          M.resume,
          M.next,
          M.collapse,
          M.expand,
        ]}
        points={[
          [22, 1600, 170],
          [22.6, 1400, 594],
          [22.7, 1400, 594],
          [23.4, 1230, 754],
          [24.1, 1050, 575],
          [24.65, 263, 727],
          [25.25, 1056, 727],
          [25.45, 1056, 727],
          [26.1, 1056, 727],
          [26.85, 1105, 727],
          [27.05, 1105, 727],
          [27.6, 1230, 727],
          [28.35, 1380, 727],
          [28.8, 1150, 442],
          [29.08, 1150, 442],
          [29.4, 1335, 442],
          [30.2, 1610, 660],
          [32.9, 1620, 844],
        ]}
      />
    </>
  );
}
