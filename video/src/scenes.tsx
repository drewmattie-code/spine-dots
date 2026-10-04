import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { loadFont as loadSans } from "@remotion/google-fonts/Manrope";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { COLORS as C, COPY, VANILLA, GOVERNED, Line } from "./content";

const sans = loadSans().fontFamily;
const mono = loadMono().fontFamily;
const col = (name?: string, dim?: boolean) =>
  dim ? C.ink3 : name && (C as Record<string, string>)[name] ? (C as Record<string, string>)[name] : C.ink;

const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 32%, ${C.bg2}, ${C.bg})`, fontFamily: sans }}>
    {children}
  </AbsoluteFill>
);

export const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const a = interpolate(f, [4, 20], [0, 1], { extrapolateRight: "clamp" });
  const b = interpolate(f, [26, 44], [0, 1], { extrapolateRight: "clamp" });
  const y = (p: number) => interpolate(p, [0, 1], [18, 0]);
  return (
    <Stage>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center", padding: 120 }}>
        <div style={{ fontSize: 66, fontWeight: 700, color: C.ink, opacity: a, transform: `translateY(${y(a)}px)`, letterSpacing: -1 }}>
          {COPY.hookA}
        </div>
        <div style={{ fontSize: 66, fontWeight: 700, color: C.cyan, opacity: b, transform: `translateY(${y(b)}px)`, marginTop: 14, letterSpacing: -1 }}>
          {COPY.hookB}
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

const TermWindow: React.FC<{ title: string; accent: string; lines: Line[]; caption: string; start?: number }> = ({ title, accent, lines, caption, start = 6 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 200 }, durationInFrames: 14 });
  return (
    <Stage>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.96, 1])})`, opacity: pop, width: 1340 }}>
          <div style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${C.line}`, boxShadow: "0 40px 120px rgba(0,0,0,.55)" }}>
            <div style={{ background: C.chrome, padding: "16px 22px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${C.line}` }}>
              <span style={{ width: 13, height: 13, borderRadius: 99, background: "#ff5f57" }} />
              <span style={{ width: 13, height: 13, borderRadius: 99, background: "#febc2e" }} />
              <span style={{ width: 13, height: 13, borderRadius: 99, background: "#28c840" }} />
              <span style={{ marginLeft: 14, color: C.ink2, fontFamily: mono, fontSize: 20 }}>{title}</span>
              <span style={{ marginLeft: "auto", color: accent, fontFamily: mono, fontSize: 18, fontWeight: 700 }}>▮</span>
            </div>
            <div style={{ background: C.panel, padding: "30px 34px", minHeight: 520, fontFamily: mono, fontSize: 25, lineHeight: 1.62 }}>
              {lines.map((ln, i) => {
                const at = start + ln.at;
                const o = interpolate(f, [at, at + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                const x = interpolate(o, [0, 1], [-10, 0]);
                return (
                  <div key={i} style={{ color: col(ln.c, ln.dim), opacity: o, transform: `translateX(${x}px)`, whiteSpace: "pre", minHeight: ln.t ? undefined : 18 }}>
                    {ln.t}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ textAlign: "center", marginTop: 26, color: accent, fontSize: 28, fontWeight: 700, letterSpacing: 0.3 }}>{caption}</div>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

export const Vanilla: React.FC = () => <TermWindow title="OpenDots" accent={C.danger} lines={VANILLA} caption={COPY.vanillaCap} />;
export const Governed: React.FC = () => <TermWindow title="SPINE-dots" accent={C.cyan} lines={GOVERNED} caption={COPY.governedCap} />;

export const Close: React.FC = () => {
  const f = useCurrentFrame();
  const a = interpolate(f, [2, 18], [0, 1], { extrapolateRight: "clamp" });
  const b = interpolate(f, [16, 32], [0, 1], { extrapolateRight: "clamp" });
  return (
    <Stage>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div style={{ opacity: a, fontSize: 96, fontWeight: 800, letterSpacing: -2, color: C.ink }}>
          SPINE<span style={{ color: C.cyan }}>-dots</span>
        </div>
        <div style={{ opacity: a, fontSize: 30, color: C.ink2, marginTop: 10 }}>{COPY.tagline}</div>
        <div style={{ opacity: b, marginTop: 40, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: mono, fontSize: 28, color: C.cyan }}>{COPY.repo}</div>
          <div style={{ fontSize: 22, color: C.ink3, letterSpacing: 1 }}>{COPY.license}</div>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
