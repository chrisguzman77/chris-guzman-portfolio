import { ImageResponse } from "next/og";

const BACKGROUND = "#0d1117";
const FOREGROUND = "#e6edf3";
const MUTED = "#9da7b3";
const ACCENT = "#7ee2b8";
const BORDER = "#21262d";

export function ogImage({ title, prompt }: { title: string; prompt: string }): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: BACKGROUND,
        color: FOREGROUND,
      }}
    >
      <div style={{ display: "flex", fontSize: 32, color: ACCENT }}>{prompt}</div>
      <div
        style={{
          display: "flex",
          fontSize: title.length > 48 ? 60 : 80,
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          borderTop: `2px solid ${BORDER}`,
          paddingTop: 28,
          fontSize: 28,
          color: MUTED,
        }}
      >
        <span style={{ color: ACCENT }}>~/chris-guzman</span>
        <span>christopherguzman.me</span>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
