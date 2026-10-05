// AGS — Agent Governance Spine.
// Badge access + a signed, hash-chained, Merkle-anchored audit log. Each entry is Ed25519-signed, so
// an attacker with write access cannot silently rewrite history (they can recompute hashes but can't
// re-sign without the private key). Policy decides what opens, FAIL-CLOSED (default-deny, deny-
// overrides). (In production the signing key lives in a KMS/HSM and anchors go to an external witness
// — RFC 3161 TSA / transparency log / WORM bucket; see SPEC.md. The core ships a reference signer.)
import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { appendLog, readLog, nextSeq } from '../store.js';
import { Decision } from '../types.js';
import { evaluatePolicy as evalJsonPolicy, DEFAULT_POLICY as JSON_DEFAULT } from '../policy/engine.js';
import { evalExpr } from '../policy/expr.js';

const LOG = 'ags-log';
const ANCHORS = 'ags-anchors';

// Reference signing key. One per process; in production this is a KMS/HSM handle the host never sees.
const { publicKey: AUDIT_PUBLIC_KEY, privateKey: AUDIT_PRIVATE_KEY } = generateKeyPairSync('ed25519');
export const publicKey = () => AUDIT_PUBLIC_KEY.export({ type: 'spki', format: 'pem' });

const sha256 = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex');
const signHash = (hash) => cryptoSign(null, Buffer.from(hash), AUDIT_PRIVATE_KEY).toString('base64');
const verifyHash = (hash, sig, key = AUDIT_PUBLIC_KEY) => {
  try { return cryptoVerify(null, Buffer.from(hash), key, Buffer.from(sig, 'base64')); } catch { return false; }
};

/** Recompute the content hash of an entry (body = everything except hash + sig). */
export function recomputeHash(entry) {
  const { hash, sig, ...body } = entry;
  return sha256(body);
}

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

/** Append a signed, hash-chained entry to the audit log. Returns {id, hash, sig}. */
export function log(entry) {
  const prev = readLog(LOG);
  const prevHash = prev.length ? prev[prev.length - 1].hash : 'GENESIS';
  const seq = nextSeq(LOG);
  const id = `ags-${String(seq).padStart(6, '0')}`;
  const body = { id, seq, ts: new Date().toISOString(), prevHash, ...entry };
  const hash = sha256(body);
  const sig = signHash(hash);
  appendLog(LOG, { ...body, hash, sig }); // throws on write failure -> callers fail closed
  return { id, hash, sig };
}

/** Verify the chain is intact AND every entry's signature is valid. Returns {ok, length, brokenAt?, why?}. */
export function verifyChain(key = AUDIT_PUBLIC_KEY) {
  const entries = readLog(LOG);
  let prevHash = 'GENESIS';
  for (let i = 0; i < entries.length; i++) {
    const { hash, sig, ...body } = entries[i];
    if (body.prevHash !== prevHash) return { ok: false, length: entries.length, brokenAt: i, why: 'prevHash mismatch' };
    if (sha256(body) !== hash)       return { ok: false, length: entries.length, brokenAt: i, why: 'hash mismatch' };
    if (!verifyHash(hash, sig, key)) return { ok: false, length: entries.length, brokenAt: i, why: 'signature mismatch' };
    prevHash = hash;
  }
  return { ok: true, length: entries.length };
}

// --- Merkle anchoring: batch the log, publish a root to an external witness at intervals. ---
function merkleRoot(hashes) {
  if (hashes.length === 0) return createHash('sha256').update('EMPTY').digest('hex');
  let level = hashes.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i], b = level[i + 1] ?? level[i]; // duplicate the last if odd
      next.push(createHash('sha256').update(a + b).digest('hex'));
    }
    level = next;
  }
  return level[0];
}

/** Compute a Merkle root over all current entries and record an anchor (the external-witness stand-in). */
export function anchor() {
  const entries = readLog(LOG);
  const root = merkleRoot(entries.map((e) => e.hash));
  const prev = readLog(ANCHORS);
  const rec = { root, count: entries.length, ts: new Date().toISOString(), seq: nextSeq(ANCHORS) };
  appendLog(ANCHORS, rec);
  return rec;
}

/** Verify each recorded anchor still matches a Merkle root recomputed over the entries it covered. */
export function verifyAnchors() {
  const entries = readLog(LOG);
  const anchors = readLog(ANCHORS);
  for (const a of anchors) {
    const root = merkleRoot(entries.slice(0, a.count).map((e) => e.hash));
    if (root !== a.root) return { ok: false, brokenAnchor: a.seq, why: 'anchor root mismatch' };
  }
  return { ok: true, anchors: anchors.length };
}

export function auditLog() { return readLog(LOG); }
