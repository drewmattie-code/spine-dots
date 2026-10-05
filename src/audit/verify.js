// Standalone audit verifier. Given an exported bundle { entries, anchors, publicKey } it proves,
// using ONLY node:crypto, that no entry was added, removed, reordered or changed — without trusting
// SPINE's operators. The auditor should compare `publicKey` against one obtained out-of-band.
// Self-contained on purpose (no SPINE imports) so it can be copied out and run anywhere.
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

const sha256 = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex');

function merkleRoot(hashes) {
  if (hashes.length === 0) return createHash('sha256').update('EMPTY').digest('hex');
  let level = hashes.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i], b = level[i + 1] ?? level[i];
      next.push(createHash('sha256').update(a + b).digest('hex'));
    }
    level = next;
  }
  return level[0];
}

/** Verify an exported audit bundle. Returns {ok, entries, anchors} or {ok:false, why, brokenAt?/brokenAnchor?}. */
export function verifyExport(bundle) {
  const { entries = [], anchors = [], publicKey } = bundle || {};
  let key;
  try { key = createPublicKey(publicKey); } catch { return { ok: false, why: 'invalid or missing public key' }; }

  let prevHash = 'GENESIS';
  for (let i = 0; i < entries.length; i++) {
    const { hash, sig, ...body } = entries[i];
    if (body.prevHash !== prevHash) return { ok: false, brokenAt: i, why: 'prevHash mismatch (entry removed/reordered)' };
    if (sha256(body) !== hash)      return { ok: false, brokenAt: i, why: 'hash mismatch (entry edited)' };
    let sigOk = false;
    try { sigOk = cryptoVerify(null, Buffer.from(hash), key, Buffer.from(sig ?? '', 'base64')); } catch { sigOk = false; }
    if (!sigOk)                     return { ok: false, brokenAt: i, why: 'signature mismatch (not signed by this key)' };
    prevHash = hash;
  }

  for (const a of anchors) {
    const root = merkleRoot(entries.slice(0, a.count).map((e) => e.hash));
    if (root !== a.root) return { ok: false, brokenAnchor: a.seq, why: 'anchor root mismatch' };
  }

  return { ok: true, entries: entries.length, anchors: anchors.length };
}
