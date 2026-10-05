// v0.6 acceptance tests: a standalone verifier. An outside auditor, given only an exported audit
// bundle + the public key, can prove no entry was added/removed/changed — WITHOUT trusting SPINE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import * as ags from '../src/layers/ags.js';
import { verifyExport } from '../src/audit/verify.js';

test('verifier: an exported bundle verifies offline with its own public key', () => {
  ags.log({ event: 'v1', decision: 'BLOCK' });
  ags.log({ event: 'v2', decision: 'ALLOW' });
  ags.anchor();
  const bundle = ags.exportAudit();
  assert.ok(Array.isArray(bundle.entries) && bundle.entries.length >= 2);
  assert.ok(typeof bundle.publicKey === 'string' && bundle.publicKey.includes('PUBLIC KEY'));
  const r = verifyExport(bundle);
  assert.equal(r.ok, true);
  assert.ok(r.entries >= 2);
});

test('verifier: editing an entry in the export is detected (hash/signature mismatch)', () => {
  ags.log({ event: 'v3', decision: 'ALLOW' });
  const bundle = ags.exportAudit();
  const i = bundle.entries.length - 1;
  bundle.entries[i] = { ...bundle.entries[i], decision: 'TAMPERED' };
  const r = verifyExport(bundle);
  assert.equal(r.ok, false);
  assert.equal(r.brokenAt, i);
});

test('verifier: removing or reordering entries breaks the chain', () => {
  ags.log({ event: 'v4' });
  const bundle = ags.exportAudit();
  bundle.entries.splice(0, 1); // delete the first entry
  assert.equal(verifyExport(bundle).ok, false);
});

test('verifier: a different public key than the one that signed fails verification', () => {
  ags.log({ event: 'v5' });
  const bundle = ags.exportAudit();
  const { publicKey } = generateKeyPairSync('ed25519');
  const bogus = publicKey.export({ type: 'spki', format: 'pem' });
  const r = verifyExport({ ...bundle, publicKey: bogus });
  assert.equal(r.ok, false);
});

test('verifier: a tampered anchor root is detected', () => {
  ags.log({ event: 'v6' });
  ags.anchor();
  const bundle = ags.exportAudit();
  if (bundle.anchors.length) bundle.anchors[bundle.anchors.length - 1].root = 'deadbeef';
  const r = verifyExport(bundle);
  assert.equal(r.ok, false);
});
