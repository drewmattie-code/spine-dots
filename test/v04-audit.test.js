// v0.4 acceptance tests: signed + anchored, tamper-evident audit (fixes C6) and sequence-based
// entry IDs (fixes C14), plus fail-closed on a log-write failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ags from '../src/layers/ags.js';
import { handle } from '../src/gateway.js';
import { setupFinanceDot, RISKY_ACTION } from '../demo/setup.js';

test('C6: audit entries are Ed25519-signed and the chain verifies with signatures', () => {
  setupFinanceDot();
  ags.log({ event: 'test-a', decision: 'BLOCK' });
  ags.log({ event: 'test-b', decision: 'ALLOW' });
  const v = ags.verifyChain();
  assert.equal(v.ok, true);
  assert.ok(v.length >= 2);
  // every entry carries a signature
  const entries = ags.auditLog();
  assert.ok(entries.every((e) => typeof e.sig === 'string' && e.sig.length > 0));
});

test('C6: editing an entry fails verification (signature + hash no longer match)', () => {
  ags.log({ event: 'before-tamper', decision: 'ALLOW' });
  const entries = ags.auditLog();
  const i = entries.length - 1;
  // tamper: flip the decision on a logged entry in place
  entries[i].decision = entries[i].decision === 'ALLOW' ? 'BLOCK' : 'ALLOW';
  const v = ags.verifyChain();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, i);
});

test('C6: re-hashing a tampered entry without the private key still fails (signature mismatch)', () => {
  ags.log({ event: 'sig-test', decision: 'ALLOW' });
  const entries = ags.auditLog();
  const i = entries.length - 1;
  const e = entries[i];
  // attacker edits the body AND recomputes the hash so the chain-hash matches — but can't re-sign.
  e.decision = 'BLOCK';
  e.hash = ags.recomputeHash(e);
  const v = ags.verifyChain();
  assert.equal(v.ok, false); // signature over the old hash no longer matches
});

test('C14: entry IDs come from a monotonic sequence, not array length', () => {
  const a = ags.log({ event: 's1' });
  const b = ags.log({ event: 's2' });
  const na = Number(a.id.split('-').pop());
  const nb = Number(b.id.split('-').pop());
  assert.ok(nb > na, 'ids strictly increase');
});

test('C6: a Merkle anchor is produced and the entries verify against it', () => {
  ags.log({ event: 'anchor-me' });
  const anchor = ags.anchor(); // batch current entries, publish a root to the witness list
  assert.ok(anchor.root && typeof anchor.root === 'string');
  assert.ok(anchor.count >= 1);
  assert.equal(ags.verifyAnchors().ok, true);
});

test('C6: fail-closed — if the audit write throws, the decision becomes BLOCK', async () => {
  setupFinanceDot();
  // inject a sink that fails like a full disk; an ALLOW-able action must still come back BLOCK.
  const d = await handle(
    { dotId: 'finance-dot', task: 'read', taskType: 'read_report', tool: 'read_file', datasets: ['q3_summary.csv'] },
    { auditSink: () => { throw new Error('disk full'); } }
  );
  assert.equal(d.decision, 'BLOCK');
  assert.match(d.reasons.join(' '), /audit|log/i);
});
