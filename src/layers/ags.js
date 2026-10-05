// AGS — Agent Governance Spine.
// Badge access + a hash-chained entry log that detects edits. Policy decides what opens, FAIL-CLOSED
// (default-deny, deny-overrides). (Signed + externally-anchored audit and a declarative JSON policy
// language are on the v1.0 roadmap — see SPEC.md.)
import { createHash } from 'node:crypto';
import { appendLog, readLog } from '../store.js';
import { Decision } from '../types.js';

const LOG = 'ags-log';

// Default policy. Each rule: a `when` predicate over the evaluation context, and an `effect`
// (allow | require_approval | block). Semantics are FAIL-CLOSED (fixes v0.1's default-ALLOW):
// deny-overrides, then require_approval, then allow — and NOTHING runs unless a rule explicitly
// allows it. A rule whose predicate throws is treated as not-matched, so errors never allow.
export const DEFAULT_POLICY = [
  // blocks (win over everything — deny-overrides)
  { id: 'forbid-unregistered',    when: (c) => !c.registered,                                          effect: 'block', reason: 'Dot is not registered/approved in ARS' },
  { id: 'forbid-undiscovered',    when: (c) => !c.toolAuthorized,                                      effect: 'block', reason: 'tool was not granted by PDS for this task type' },
  { id: 'forbid-egress-scope',    when: (c) => c.external && c.egressScope !== 'external-allowed',      effect: 'block', reason: 'Dot egress scope is internal-only; external send denied by the Spine Gate grant' },
  { id: 'block-restricted-egress',when: (c) => c.external && c.peakSensitivity === 'restricted',        effect: 'block', reason: 'restricted data cannot leave the org' },
  { id: 'block-dlp-hit',          when: (c) => c.dlpHit === true,                                       effect: 'block', reason: 'outbound payload contains classified values above clearance (egress DLP)' },
  // approvals
  { id: 'approve-critical',       when: (c) => c.riskBand === 'critical',                               effect: 'require_approval', reason: 'critical risk requires human approval + an ACS check' },
  { id: 'approve-high',           when: (c) => c.riskBand === 'high',                                   effect: 'require_approval', reason: 'high risk requires human approval + an ACS check' },
  { id: 'approve-acs-objection',  when: (c) => c.acsBlocking,                                           effect: 'require_approval', reason: 'the ACS checker raised a blocking objection' },
  // explicit allow (nothing runs without one — default deny)
  { id: 'allow-authorized',       when: (c) => c.registered && c.toolAuthorized && !(c.external && c.egressScope !== 'external-allowed'), effect: 'allow', reason: 'registered Dot, tool granted by task type, within egress scope' },
];

export function requiresACS(ctx) {
  return ctx.riskBand === 'high' || ctx.riskBand === 'critical' || (ctx.external && ctx.peakSensitivity !== 'public');
}

/** Evaluate policy against a context, fail-closed. Returns {decision, reasons[]}. */
export function evaluate(ctx, policy = DEFAULT_POLICY) {
  const matched = [];
  for (const rule of policy) {
    let hit = false;
    try { hit = rule.when(ctx); } catch { hit = false; } // a throwing predicate never allows
    if (hit) matched.push(rule);
  }
  const has = (e) => matched.some((r) => r.effect === e);
  let decision;
  if (has('block')) decision = Decision.BLOCK;
  else if (has('require_approval')) decision = Decision.NEEDS_APPROVAL;
  else if (has('allow')) decision = Decision.ALLOW;
  else decision = Decision.BLOCK; // default deny
  const reasons = matched.map((r) => `${r.id}: ${r.reason}`);
  if (decision === Decision.BLOCK && !has('block')) reasons.push('default-deny: no rule explicitly allowed this action');
  return { decision, reasons };
}

/** Append a tamper-evident entry to the hash-chained audit log. Returns {id, hash}. */
export function log(entry) {
  const prev = readLog(LOG);
  const prevHash = prev.length ? prev[prev.length - 1].hash : 'GENESIS';
  const id = `ags-${String(prev.length + 1).padStart(6, '0')}`;
  const body = { id, ts: new Date().toISOString(), prevHash, ...entry };
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  appendLog(LOG, { ...body, hash });
  return { id, hash };
}

/** Verify the hash chain is intact (nothing was edited). Returns {ok, length, brokenAt?}. */
export function verifyChain() {
  const entries = readLog(LOG);
  let prevHash = 'GENESIS';
  for (let i = 0; i < entries.length; i++) {
    const { hash, ...body } = entries[i];
    if (body.prevHash !== prevHash) return { ok: false, length: entries.length, brokenAt: i, why: 'prevHash mismatch' };
    const recomputed = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    if (recomputed !== hash) return { ok: false, length: entries.length, brokenAt: i, why: 'hash mismatch' };
    prevHash = hash;
  }
  return { ok: true, length: entries.length };
}

export function auditLog() { return readLog(LOG); }
