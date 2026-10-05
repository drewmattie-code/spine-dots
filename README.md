# SPINE-dots

[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)
![runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
![governance for](https://img.shields.io/badge/governance%20for-CopilotKit%20Dots-35d6c6)
![self-hosted](https://img.shields.io/badge/self--hosted-yes-2cc9b0)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](adapters/opendots.md)

**The open-source governance layer for [CopilotKit Dots](https://github.com/CopilotKit/OpenDots).**

![SPINE-dots demo — the same payroll action, vanilla OpenDots vs SPINE-dots](media/demo.gif)

OpenDots gives you always-on AI coworkers. SPINE-dots adds a **governance decision to every Dot tool
call**. It wraps an OpenDots runtime with the **Spine's eight governance layers + the Spine Gate**, so
before any action runs it is registered, risk-scored, **data-scoped** (fields above the Dot's clearance
never reach the tool), **egress-checked** against an org allowlist, **policy-gated fail-closed**, and
written to a hash-chained audit log.

> **Status: v0.2.** The enforcement below (data mediation + DLP, task-type tool grants, egress
> allowlist, fail-closed policy) is real and covered by acceptance tests — run `npm test`. The v1.0
> hardening roadmap (signed + externally-anchored audit, a declarative policy language, the MCP
> gateway, published npm packages) is in **[SPEC.md](SPEC.md)**.

> A runtime answers *"can my agent do things?"* Governance answers *"should it, this time, and who
> dropped the ball when it shouldn't have?"* SPINE-dots is the second half.

https://github.com/drewmattie-code/spine-dots · MIT · zero runtime dependencies · self-hosted

## The 30-second demo

```bash
node demo/run.mjs
```

A **Finance Dot** is told to *"email the Q3 payroll summary to the vendor."*

- **Vanilla OpenDots:** a human gets one approval card, clicks **Approve** blind — and restricted
  salary + SSN data is emailed to an outside vendor. Nobody can prove who checked it.
- **SPINE-dots:** the same action is scored **CRITICAL (100/100)**, the salary/SSN fields are
  **stripped from the payload the tool receives and the values pasted into the email body are caught by
  DLP (GDS)**, an adversarial **checker (ACS)** flags the external recipient and the scope violation,
  policy **BLOCKS** it **fail-closed**, and a **hash-chained audit entry (AGS)** records exactly what
  happened — and the Dot only reached production by passing the **Spine Gate**, which never cleared it
  to email outsiders in the first place.

Same action. One blind click vs. a risk score, a second opinion, scoped data, a blocked leak, and a
hash-chained record that detects tampering. **That's the whole product.**

🎬 The clip above is [`media/demo.gif`](media/demo.gif); the full-quality 1080p version is [`media/demo.mp4`](media/demo.mp4).

## The eight layers (+ the Gate)

| Layer | Job (the plain-English analogy) |
|---|---|
| **PDS** — Progressive Discovery Spine | the supply room: a Dot gets only the tools its **registered task type** allows — never the ones its (agent-written) task text asks for |
| **ACS** — Adversarial Coordination Spine | separation of duties: a *different* checker reviews the maker's risky actions |
| **ESF** — External Signal Fabric | the fact-checking desk: outside info stamped with source, freshness, reliability |
| **CRI** — Composite Risk Index | a credit score that shows its work: the parts that made the number |
| **AGS** — Agent Governance Spine | badge access + a tamper-proof log: doors that won't open, history that can't be edited |
| **DCS** — Durable Context Spine | the shift-handover log: the next agent picks up where the last left off |
| **GDS** — Grounded Data Spine | the company dictionary + a locked records room: one set of facts, field-level access |
| **ARS** — Agent Registry Spine | the master staff + equipment list: who exists, who's approved, which version |
| **Spine Gate** | the one funnel from practice room (sandbox) to production floor — riskier job, higher bar |

Full background: *The Spine, Plain-English 101* and the Enterprise Architecture White Paper at
[saasquach.ai/spine](https://saasquach.ai/spine).

## How it works

OpenDots stays the **runtime**. SPINE-dots is a **control plane** reached through one hook — the tool
dispatch. Before any tool runs, the gateway orchestrates the layers into a single decision:

```
   OpenDots tool dispatch
            │
            ▼
   gateway.handle(action)
            │
   ARS → PDS → GDS → CRI → ACS → AGS(policy) ──► ALLOW · NEEDS_APPROVAL · BLOCK
            │                         │
       (registry)              (hash-chained log)
```

```js
// Clone the repo and import from source — npm packages land at v1.0 (see SPEC.md).
import { handle } from './src/gateway.js';

const decision = await handle({
  dotId: 'finance-dot',
  task: 'email the Q3 payroll summary to the vendor', // free text — NOT used to grant tools
  taskType: 'send_report',                            // operator-assigned; this grants the tools
  tool: 'send_email',
  recipient: 'accounts@vendor-supplier.com',
  datasets: ['payroll.csv'],
}, { egressAllowlist: { domains: ['acme.corp'] } });
// decision.decision -> 'BLOCK'
// decision.card      -> enriched approval card (risk, objections, redactions, audit id)
```

Wiring it into a real OpenDots deployment is one middleware hook — see
[`adapters/opendots.md`](adapters/opendots.md).

## Quickstart

```bash
git clone https://github.com/drewmattie-code/spine-dots
cd spine-dots
node demo/run.mjs           # the side-by-side
node demo/run.mjs --vanilla # just the ungoverned path
node --test                 # tests
node src/layers/gate.js check finance-dot production   # try the Spine Gate CLI
```

No install, no build step, no services — zero runtime dependencies, Node ≥ 20. Set `SPINE_DATA_DIR`
to persist the registry + audit log to JSON; swap `src/store.js` for Postgres in production.

## What this is (and isn't)

- **Is:** a working reference implementation of Spine governance over OpenDots — real layers, real
  decisions, auditable, self-hosted. Built to make the runtime-vs-governance distinction concrete.
- **Isn't:** a hosted service, or a fork of OpenDots. It governs *your* OpenDots deployment from the
  outside, friendly to the ecosystem. The risk scoring and policy here are sensible defaults you are
  meant to tune for your org.

## Credits

Built on the **Spine** framework by [SaaSquach AI Labs](https://saasquach.ai) (a division of Charles &
Roe Inc.). Governs [CopilotKit's OpenDots](https://github.com/CopilotKit/OpenDots). MIT licensed.
