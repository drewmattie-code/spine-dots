# Wiring SPINE-dots into an OpenDots runtime

SPINE-dots governs [OpenDots](https://github.com/CopilotKit/OpenDots) through **one hook**: the tool
dispatch. Everything else in your OpenDots deployment stays as-is, so upstream updates don't break you.

## The one hook
OpenDots routes every Dot tool call through the CopilotKit runtime (and, for writes, through a
human-in-the-loop approval card). Call `gateway.handle()` at that moment, before the tool executes:

```js
import { handle } from './src/gateway.js'; // npm package lands at v1.0 (see SPEC.md)

// inside your OpenDots tool-dispatch middleware:
async function dispatchTool(dot, task, toolName, args) {
  const decision = await handle({
    dotId: dot.id,
    task,                       // the Dot's current objective (OpenDots has this in the thread)
    tool: toolName,
    args,
    datasets: args.datasets ?? [],
    recipient: args.to ?? args.recipient,
  }, { acsClient });            // optional: a checker-Dot client (see ACS below)

  if (decision.decision === 'BLOCK') return refuse(decision);          // never runs
  if (decision.decision === 'NEEDS_APPROVAL') return showCard(decision.card); // enriched approval card
  return runTool(toolName, args);                                      // ALLOW
}
```

`decision.card` is a drop-in upgrade for the OpenDots approval card: instead of a bare "Approve?", it
carries the **risk score + factors (CRI)**, the **checker's objections (ACS)**, the **fields that were
redacted (GDS)**, and the **audit id (AGS)**.

## Mapping OpenDots → the eight layers
| Spine layer | What SPINE-dots adds | OpenDots piece it builds on |
|---|---|---|
| ARS | registry of every Dot/tool/version, approved + tiered | the per-Dot definitions (register each Dot on create) |
| PDS | task-type-scoped tool grants (not from agent free text) | the per-Dot tool permission matrix (becomes the fallback allowlist) |
| GDS | definitions + field-level data scoping | the tools that read data (wrap the data-read tools) |
| CRI | explainable risk score per action | — (new) |
| ACS | adversarial checker on high-risk actions | spawn a second **checker Dot** via the OpenDots runtime (own container, no shared context) — pass an `acsClient` with a `review()` method |
| AGS | policy engine + hash-chained audit log | the approval cards + activity records (becomes the enforcement + log surface) |
| ESF | provenance envelope for outside data | the source-link tracking + Parallel.ai research |
| DCS | structured shift-handover record | durable **Threads** + per-Dot workspace memory |
| Spine Gate | sandbox → production promotion | run `gate.promote(dotId, tier)` before a Dot handles real work |

## The ACS checker client
For a real adversarial check, give `handle()` an `acsClient` whose `review()` spins up a separate
OpenDots Dot with an adversarial prompt and no shared memory:

```js
const acsClient = {
  async review({ action, risk, redactions }) {
    const dot = await openDots.createEphemeralDot({ instructions: ADVERSARIAL_PROMPT });
    return dot.judge({ action, risk, redactions }); // -> { objections, blocking }
  }
};
```

Without an `acsClient`, SPINE-dots falls back to the built-in rule-based checker (deterministic, offline).

## Storage
The reference store is in-memory (plus optional JSON via `SPINE_DATA_DIR`). For production, swap
`src/store.js` for a Postgres-backed implementation of the same four functions
(`appendLog`, `readLog`, `collection`, …). Nothing else changes.
