import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/gateway.js';
import * as ars from '../src/layers/ars.js';
import * as ags from '../src/layers/ags.js';
import { Tier, Sensitivity, ToolClass } from '../src/types.js';
import { setupFinanceDot, RISKY_ACTION, FINANCE_DOT_ID } from '../demo/setup.js';

test('unregistered Dot is blocked', async () => {
  const d = await handle({ dotId: 'ghost', task: 'read', tool: 'read_file', datasets: [] });
  assert.equal(d.decision, 'BLOCK');
  assert.match(d.reasons.join(' '), /ARS/);
});

test('Spine Gate promotes the Finance Dot to production', () => {
  const { promotion, dot } = setupFinanceDot();
  assert.equal(promotion.promoted, true);
  assert.equal(dot.tier, Tier.PRODUCTION);
  assert.equal(dot.approved, true);
});

test('governed payroll-to-vendor action is blocked with full reasoning', async () => {
  setupFinanceDot();
  const d = await handle(RISKY_ACTION);
  assert.equal(d.decision, 'BLOCK');
  assert.equal(d.risk.band, 'critical');
  // GDS redacted the restricted compensation fields
  const redactedFields = d.data.redacted.map((r) => r.field);
  assert.ok(redactedFields.includes('salary') && redactedFields.includes('ssn'));
  // ACS raised a blocking objection about the scope violation
  assert.ok(d.objections.some((o) => o.severity === 'critical'));
});

test('a benign in-scope action is allowed', async () => {
  ars.register({
    id: 'reader-dot', name: 'Reader', owner: 'ops@acme.corp', approved: true, tier: Tier.PRODUCTION,
    toolClasses: [ToolClass.READ], clearance: Sensitivity.INTERNAL, egressScope: 'internal-only',
  });
  const d = await handle({ dotId: 'reader-dot', task: 'summarize the q3 summary', tool: 'read_file', datasets: ['q3_summary.csv'] });
  assert.equal(d.decision, 'ALLOW');
  assert.equal(d.data.redacted.length, 0);
});

test('AGS audit log is hash-chained and verifies intact', async () => {
  setupFinanceDot();
  await handle(RISKY_ACTION);
  const chain = ags.verifyChain();
  assert.equal(chain.ok, true);
  assert.ok(chain.length >= 1);
});
