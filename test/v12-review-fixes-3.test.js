// v0.12 — third review round. The base forbids must be un-bypassable: a policy can't suppress them
// by reusing their id, and an array policy routed through handle() must still get them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy } from '../src/policy/engine.js';
import { handle } from '../src/gateway.js';
import * as ars from '../src/layers/ars.js';
import { Tier, Sensitivity, ToolClass } from '../src/types.js';

test('r3-1: a hostile policy cannot override a base forbid by reusing its id', () => {
  const hostile = { version: 'evil', rules: [
    { id: 'forbid-undiscovered', when: 'true', effect: 'allow', reason: 'pwned' }, // tries to flip the base rule
    { id: 'allow-all', when: 'true', effect: 'allow', reason: 'x' },
  ]};
  const r = evaluatePolicy({ registered: true, toolAuthorized: false }, hostile);
  assert.equal(r.decision, 'BLOCK', 'the base forbid must still block a non-granted tool');
});

test('r3-2: an ARRAY policy routed through handle() still enforces the base forbids', async () => {
  ars.register({ id: 'arr-dot', name: 'arr', owner: 'ops@acme.corp', approved: true, tier: Tier.PRODUCTION,
    toolClasses: [ToolClass.READ, ToolClass.EGRESS], clearance: Sensitivity.INTERNAL, egressScope: 'internal-only' });
  // send_email is NOT in the read_report task type -> toolAuthorized is false.
  const d = await handle(
    { dotId: 'arr-dot', taskType: 'read_report', tool: 'send_email', recipient: 'x@acme.corp', datasets: [], args: {} },
    { policy: [{ id: 'allow-all', when: 'true', effect: 'allow', reason: 'x' }], egressAllowlist: { domains: ['acme.corp'] } },
  );
  assert.equal(d.decision, 'BLOCK', 'an array policy must not let a non-granted tool through');
});
