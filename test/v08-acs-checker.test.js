// v0.8 acceptance tests: the ACS checker contract (fixes C3). A checker runs with a timeout that
// FAILS CLOSED — timeout, malformed output, or a throw all become a blocking objection. The checker's
// identity is recorded with its verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llmCheck } from '../src/layers/acs.js';

const CTX = { action: { tool: 'send_email' }, dot: { egressScope: 'internal-only' }, risk: { band: 'critical', score: 100 } };

test('C3: a checker that exceeds the timeout produces a blocking objection (fail closed)', async () => {
  const slow = { id: 'checker@slow', review: () => new Promise((r) => setTimeout(() => r({ objections: [], blocking: false }), 1000)) };
  const r = await llmCheck(CTX, slow, { timeoutMs: 40 });
  assert.equal(r.blocking, true);
  assert.ok(r.objections.some((o) => /time/i.test(o.note)));
  assert.equal(r.checker, 'checker@slow');
});

test('C3: malformed checker output produces a blocking objection', async () => {
  const bad = { id: 'checker@bad', review: async () => ({ not: 'a verdict' }) };
  const r = await llmCheck(CTX, bad, { timeoutMs: 500 });
  assert.equal(r.blocking, true);
  assert.ok(r.objections.some((o) => /malformed/i.test(o.note)));
});

test('C3: a checker that throws fails closed to a blocking objection', async () => {
  const boom = { id: 'checker@boom', review: async () => { throw new Error('model unavailable'); } };
  const r = await llmCheck(CTX, boom, { timeoutMs: 500 });
  assert.equal(r.blocking, true);
});

test('C3: a well-formed verdict is used as-is, with the checker identity recorded', async () => {
  const good = { id: 'checker-dot@provider-x', review: async () => ({ objections: [{ severity: 'high', note: 'external recipient' }], blocking: true, checker: 'checker-dot@provider-x' }) };
  const r = await llmCheck(CTX, good, { timeoutMs: 500 });
  assert.equal(r.blocking, true);
  assert.equal(r.checker, 'checker-dot@provider-x');
  assert.equal(r.objections[0].severity, 'high');
});

test('C3: with no client, the deterministic reference rule-checker is used', async () => {
  const r = await llmCheck({ action: { recipient: 'x@vendor.com' }, dot: { egressScope: 'internal-only' }, risk: { band: 'critical' } });
  assert.ok(Array.isArray(r.objections));
  assert.equal(typeof r.checker, 'string');
});
