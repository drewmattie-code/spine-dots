// Everything a person would change without touching the animation: copy, colours, scene lengths,
// and the two terminal "runs" shown (ungoverned vs governed).
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const COLORS = {
  bg: "#090d13",
  bg2: "#0c1320",
  panel: "#0e141d",
  line: "#1b2430",
  chrome: "#111a26",
  ink: "#eaf2f7",
  ink2: "#8ea0b0",
  ink3: "#5e7183",
  cyan: "#35d6c6",
  gold: "#e3b24a",
  danger: "#ff5d5d",
  safe: "#3ad39a",
  amber: "#f2a43a",
};

export const SCENES = { hook: 3.4, vanilla: 5.6, governed: 8.0, close: 4.0 };
export const TRANSITION_S = 0.45;

export const COPY = {
  hookA: "Your AI agents can do anything.",
  hookB: "The question is whether they should.",
  wordmark: "SPINE-dots",
  tagline: "The open-source governance layer for CopilotKit Dots",
  vanillaCap: "Vanilla OpenDots — one blind click",
  governedCap: "SPINE-dots — eight layers, one decision",
  closeLine: "Governance for always-on AI agents.",
  repo: "github.com/drewmattie-code/spine-dots",
  license: "MIT · zero dependencies · self-hosted",
};

export type Line = { t: string; c?: string; at: number; mono?: boolean; dim?: boolean };

// The ungoverned run: a bare approval card, approved blind, data leaves.
export const VANILLA: Line[] = [
  { t: "finance-dot ▸ email the Q3 payroll summary to the vendor", at: 0, dim: true },
  { t: "", at: 6 },
  { t: "  ┌ approval ─────────────────────────────────┐", at: 10 },
  { t: "  │  send_email  →  accounts@vendor-supplier.com │", at: 16 },
  { t: "  │  reads: payroll.csv                          │", at: 22 },
  { t: "  │            [ Approve ]   [ Deny ]            │", at: 28 },
  { t: "  └──────────────────────────────────────────────┘", at: 34 },
  { t: "  ▸ Approve  (no risk score, no second opinion)", c: "safe", at: 42 },
  { t: "  ▶ SENT: payroll.csv incl. salary, ssn → vendor", c: "danger", at: 56 },
  { t: "  ▶ restricted data left the company. no record of who checked it.", c: "danger", at: 66 },
];

// The governed run: the same action through the eight layers → BLOCK with reasons.
export const GOVERNED: Line[] = [
  { t: "finance-dot ▸ email the Q3 payroll summary to the vendor", at: 0, dim: true },
  { t: "", at: 4 },
  { t: "ARS   ✓ registered · production · passed the Spine Gate", c: "cyan", at: 8 },
  { t: "PDS   ✓ send_email handed out for this task", c: "cyan", at: 16 },
  { t: "GDS   ⦸ redacted  payroll.salary, payroll.ssn  [restricted]", c: "amber", at: 26 },
  { t: "CRI   ⚠ risk  CRITICAL  100/100", c: "amber", at: 38 },
  { t: "        egress +30 · restricted +35 · irreversible +20 · external +18", at: 46, dim: true },
  { t: "ACS   ✗ checker: recipient is OUTSIDE the org", c: "danger", at: 58 },
  { t: "ACS   ✗ checker: egress scope is internal-only — scope violation", c: "danger", at: 68 },
  { t: "AGS   ■ policy → BLOCK   ·   logged ags-000001 (hash-chained)", c: "danger", at: 80 },
  { t: "", at: 90 },
  { t: "▶ the leak never happened. the attempt is on the record.", c: "safe", at: 96 },
];
