// AGS — Agent Governance Spine.
// Badge access + a signed, hash-chained, Merkle-anchored audit log. Each entry is Ed25519-signed, so
// an attacker with write access cannot silently rewrite history (they can recompute hashes but can't
// re-sign without the private key). Policy decides what opens, FAIL-CLOSED (default-deny, deny-
// overrides). (In production the signing key lives in a KMS/HSM and anchors go to an external witness
// — RFC 3161 TSA / transparency log / WORM bucket; see SPEC.md. The core ships a reference signer.)
import { createHash, generateKeyPairSync, createPublicKey, createPrivateKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appendLog, readLog, nextSeq } from '../store.js';
import { Decision } from '../types.js';
import { evaluatePolicy as evalJsonPolicy, DEFAULT_POLICY as JSON_DEFAULT } from '../policy/engine.js';

const LOG = 'ags-log';
const ANCHORS = 'ags-anchors';

/**
 * Load the Ed25519 signing keypair so it SURVIVES RESTARTS (otherwise a restart regenerates the key
 * and every old signature fails verification — a false tamper alarm). Order: SPINE_AUDIT_PRIVATE_KEY
 * env (PEM), then <dir>/audit-key.pem (generated + persisted on first run), then an ephemeral key for
 * in-memory deployments.
 *
 * ⚠️ SECURITY (reference build): the file-based key lives in the SAME directory as the log, so anyone
 * who can edit the log can also read the key and re-sign a forged chain. That is acceptable only for a
 * self-hosted reference build. In PRODUCTION the signing key MUST live in a KMS/HSM the host never
 * reads (pass it via SPINE_AUDIT_PRIVATE_KEY from a secret manager, or wire a KMS signer), so edit
 * access to the log does not grant the ability to re-sign.
 */
export function loadOrCreateKey(dir = process.env.SPINE_DATA_DIR || null) {
  if (process.env.SPINE_AUDIT_PRIVATE_KEY) {
    const privateKey = createPrivateKey(process.env.SPINE_AUDIT_PRIVATE_KEY);
    return { publicKey: createPublicKey(privateKey), privateKey };
  }
  if (!dir) return generateKeyPairSync('ed25519');
  const file = join(dir, 'audit-key.pem');
  if (existsSync(file)) {
    const privateKey = createPrivateKey(readFileSync(file, 'utf8'));
    return { publicKey: createPublicKey(privateKey), privateKey };
  }
  const kp = generateKeyPairSync('ed25519');
  try { mkdirSync(dir, { recursive: true }); writeFileSync(file, kp.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 }); } catch { /* fall back to ephemeral */ }
  return kp;
}

const { publicKey: AUDIT_PUBLIC_KEY, privateKey: AUDIT_PRIVATE_KEY } = loadOrCreateKey();
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
 * Evaluate policy against a context, fail-closed. There is ONE enforcement path: this delegates to the
 * policy engine for every policy shape — a declarative JSON document ({version, rules}) and a legacy
 * array of rules (string OR function `when`, used by unit tests) alike. That guarantees the always-on
 * BASE_FORBID rules apply no matter which shape reaches handle(); no policy can route around them.
 * Returns {decision, reasons[]}.
 */
export function evaluate(ctx, policy = DEFAULT_POLICY) {
  const { decision, reasons } = evalJsonPolicy(ctx, policy);
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

/** A portable audit bundle an outside auditor can verify offline (entries + anchors + public key). */
export function exportAudit() {
  return { entries: readLog(LOG), anchors: readLog(ANCHORS), publicKey: publicKey() };
}
