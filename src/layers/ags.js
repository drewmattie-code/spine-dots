// AGS — Agent Governance Spine.
// Badge access + a tamper-evident entry log. Policy decides what opens; the log is append-only and
// hash-chained so no one can quietly edit history later. Policy is data (JSON), not code.
import { createHash } from 'node:crypto';
import { appendLog, readLog } from '../store.js';
import { Decision } from '../types.js';

const LOG = 'ags-log';

// Default policy. Each rule: a `when` predicate over the evaluation context, and a `then` requirement.
// First matching rule wins; requirements escalate ALLOW < NEEDS_APPROVAL < BLOCK.
export const DEFAULT_POLICY = [
  { id: 'forbid-unregistered', when: (c) => !c.registered,              then: Decision.BLOCK,          reason: 'Dot is not registered/approved in ARS' },
  { id: 'forbid-undiscovered', when: (c) => !c.toolAuthorized,          then: Decision.BLOCK,          reason: 'tool was not handed out by PDS for this task' },
  { id: 'forbid-egress-scope', when: (c) => c.external && c.egressScope !== 'external-allowed', then: Decision.BLOCK, reason: 'Dot egress scope is internal-only; external send denied by the Spine Gate grant' },
  { id: 'block-restricted-egress', when: (c) => c.external && c.peakSensitivity === 'restricted', then: Decision.BLOCK, reason: 'restricted data cannot leave the org' },
  { id: 'approve-critical',    when: (c) => c.riskBand === 'critical', then: Decision.NEEDS_APPROVAL, reason: 'critical risk requires human approval + an ACS check' },
  { id: 'approve-high',        when: (c) => c.riskBand === 'high',     then: Decision.NEEDS_APPROVAL, reason: 'high risk requires human approval + an ACS check' },
  { id: 'approve-acs-objection', when: (c) => c.acsBlocking,           then: Decision.NEEDS_APPROVAL, reason: 'the ACS checker raised a blocking objection' },
];

export function requiresACS(ctx) {
  return ctx.riskBand === 'high' || ctx.riskBand === 'critical' || (ctx.external && ctx.peakSensitivity !== 'public');
}

/** Evaluate policy against a context. Returns {decision, reasons[]}. */
export function evaluate(ctx, policy = DEFAULT_POLICY) {
  const reasons = [];
  let decision = Decision.ALLOW;
  const rank = { [Decision.ALLOW]: 0, [Decision.NEEDS_APPROVAL]: 1, [Decision.BLOCK]: 2 };
  for (const rule of policy) {
    let hit = false;
    try { hit = rule.when(ctx); } catch { hit = false; }
    if (hit) { reasons.push(`${rule.id}: ${rule.reason}`); if (rank[rule.then] > rank[decision]) decision = rule.then; }
  }
  if (decision === Decision.ALLOW) reasons.push('no policy rule blocked or flagged this action');
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
