# SPINE-dots

**The open-source governance layer for [CopilotKit Dots](https://github.com/CopilotKit/OpenDots).**

OpenDots gives you always-on AI coworkers. SPINE-dots makes them safe to run at scale. It wraps an
OpenDots runtime with the **Spine's eight governance layers + the Spine Gate**, so every Dot action is
registered, risk-scored, adversarially checked, data-scoped, policy-gated, and written to a
tamper-evident log — before it executes.

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
- **SPINE-dots:** the same action is scored **CRITICAL (100/100)**, the salary/SSN columns are
  **redacted (GDS)**, an adversarial **checker (ACS)** flags the external recipient and the scope
  violation, policy **BLOCKS** it, and a **hash-chained audit entry (AGS)** records exactly what
  happened — and the Dot only reached production by passing the **Spine Gate**, which never cleared it
  to email outsiders in the first place.

Same action. One blind click vs. a risk score, a second opinion, scoped data, a blocked leak, and a
record no one can quietly edit. **That's the whole product.**

🎬 See [`media/demo.mp4`](media/demo.mp4) for the 60-second walkthrough.

## The eight layers (+ the Gate)

| Layer | Job (the plain-English analogy) |
|---|---|
| **PDS** — Progressive Discovery Spine | the supply room: hand a Dot only the tools its task needs — and the only door to data |
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
import { handle } from 'spine-dots';

const decision = await handle({
  dotId: 'finance-dot',
  task: 'email the Q3 payroll summary to the vendor',
  tool: 'send_email',
  recipient: 'accounts@vendor-supplier.com',
  datasets: ['payroll.csv'],
});
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
