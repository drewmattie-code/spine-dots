// v0.9 acceptance tests: the Spine Gate per-tier conformance suite (fixes C8). Promotion requires
// evidence — eval pass rate, red-team pass rate, and named high-privilege grants with an approver and
// a non-expired expiry — graded against a per-tier bar. Any failure blocks promotion and names the
// failing check. Demotion drops a Dot back to sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as gate from '../src/layers/gate.js';
import * as ars from '../src/layers/ars.js';
import * as dcs from '../src/layers/dcs.js';
import { Tier, Sensitivity, ToolClass } from '../src/types.js';

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
const goodGrants = [{ toolClass: ToolClass.EGRESS, approver: 'cfo@acme.corp', expiry: future }];

function reg(id, extra = {}) {
  dcs.update(id, { open: [], done: ['reconciled'] });
  ars.register({ id, name: id, owner: 'cfo@acme.corp', version: '1.0.0', tier: Tier.SANDBOX, approved: false,
    toolClasses: [ToolClass.READ, ToolClass.EGRESS], clearance: Sensitivity.CONFIDENTIAL, egressScope: 'internal-only', ...extra });
}

test('C8: production promotion fails when the eval pass rate is below the tier bar (names the check)', () => {
  reg('c8-loweval');
  const r = gate.check('c8-loweval', Tier.PRODUCTION, { evalPassRate: 0.5, redTeamPassRate: 1.0, grants: goodGrants });
  assert.equal(r.ok, false);
  assert.ok(r.checks.find((c) => c.name.includes('eval') && !c.ok), 'the eval check must fail and be named');
});

test('C8: production promotion fails when the red-team pass rate is below the tier bar', () => {
  reg('c8-lowrt');
  const r = gate.check('c8-lowrt', Tier.PRODUCTION, { evalPassRate: 1.0, redTeamPassRate: 0.7, grants: goodGrants });
  assert.equal(r.ok, false);
  assert.ok(r.checks.find((c) => c.name.includes('red-team') && !c.ok));
});

test('C8: a high-privilege grant must have an approver and a non-expired expiry', () => {
  reg('c8-expired');
  const r = gate.check('c8-expired', Tier.PRODUCTION, { evalPassRate: 1, redTeamPassRate: 1, grants: [{ toolClass: ToolClass.EGRESS, approver: 'x', expiry: past }] });
  assert.equal(r.ok, false);
  assert.ok(r.checks.find((c) => c.name.includes('grant') && !c.ok));
});

test('C8: missing evidence fails closed for a production promotion', () => {
  reg('c8-noev');
  assert.equal(gate.check('c8-noev', Tier.PRODUCTION).ok, false);
});

test('C8: a conformant Dot (passing eval + red-team + named, in-date grants) promotes to production', () => {
  reg('c8-good');
  const { promoted, result } = gate.promote('c8-good', Tier.PRODUCTION, { evalPassRate: 0.95, redTeamPassRate: 1.0, grants: goodGrants });
  assert.equal(promoted, true, 'failing checks: ' + result.checks.filter((c) => !c.ok).map((c) => c.name).join(', '));
  assert.equal(ars.lookup('c8-good').tier, Tier.PRODUCTION);
});

test('C8: demote drops a Dot back to sandbox and unapproved (revocation / anomaly)', () => {
  reg('c8-demote', { tier: Tier.PRODUCTION, approved: true });
  const r = gate.demote('c8-demote', 'grant revoked');
  assert.equal(r.demoted, true);
  assert.equal(ars.lookup('c8-demote').tier, Tier.SANDBOX);
  assert.equal(ars.lookup('c8-demote').approved, false);
});
