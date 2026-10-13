import React from "react";
import { COLORS as C, COPY as T } from "../config.mjs";
import { bubbleState } from "../motion";
export function ChatBubble({
  t,
  text = T.message,
}: {
  t: number;
  text?: string;
}) {
  const b = bubbleState(t);
  return (
    <div
      data-qa="chat-bubble"
      style={{
        position: "absolute",
        left: "50%",
        top: 181,
        width: "max-content",
        maxWidth: 230,
        boxSizing: "border-box",
        padding: "9px 16px",
        fontSize: 25,
        lineHeight: 1.5,
        textAlign: "center",
        overflowWrap: "anywhere",
        color: C.text,
        background: C.bubble,
        border: `1px solid ${C.ice}`,
        borderRadius: 8,
        opacity: b.opacity,
        transform: `translateX(-50%) scale(${b.scale})`,
        transformOrigin: "center top",
        boxShadow: `0 6px 20px ${C.shade}`,
      }}
    >
      “{text}”
    </div>
  );
}
