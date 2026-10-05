// AGS — Agent Governance Spine.
// Badge access + a hash-chained entry log that detects edits. Policy decides what opens, FAIL-CLOSED
// (default-deny, deny-overrides). (Signed + externally-anchored audit and a declarative JSON policy
// language are on the v1.0 roadmap — see SPEC.md.)
import { createHash } from 'node:crypto';
import { appendLog, readLog } from '../store.js';
import { Decision } from '../types.js';
import { evaluatePolicy as evalJsonPolicy, DEFAULT_POLICY as JSON_DEFAULT } from '../policy/engine.js';
import { evalExpr } from '../policy/expr.js';

const LOG = 'ags-log';

// The default policy is now DECLARATIVE DATA (see src/policy/engine.js) — fail-closed, default-deny,
// deny-overrides. The gateway evaluates it through the safe expression engine.
export const DEFAULT_POLICY = JSON_DEFAULT;

export function requiresACS(ctx) {
  return ctx.riskBand === 'high' || ctx.riskBand === 'critical' || (ctx.external && ctx.peakSensitivity !== 'public');
}

/**
 * Evaluate policy against a context, fail-closed. Accepts a declarative JSON policy ({version, rules})
 * — the default — and delegates to the policy engine. Also accepts a legacy array of rules whose
 * `when` is a function OR an expression string (used by unit tests). Returns {decision, reasons[]}.
 */
export function evaluate(ctx, policy = DEFAULT_POLICY) {
  if (policy && !Array.isArray(policy) && Array.isArray(policy.rules)) {
    const { decision, reasons } = evalJsonPolicy(ctx, policy);
    return { decision, reasons };
  }
  const matched = [];
  for (const rule of policy) {
    let hit = false;
    try { hit = typeof rule.when === 'function' ? rule.when(ctx) : Boolean(evalExpr(rule.when, ctx)); } catch { hit = false; }
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
