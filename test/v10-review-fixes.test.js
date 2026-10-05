// v0.10 — fixes from an external code review (2026-10-05). Each test is a RED repro of a real gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpGateway } from '../src/mcp/gateway.js';
import { classifyRecipient } from '../src/egress.js';
import { handle } from '../src/gateway.js';
import * as ars from '../src/layers/ars.js';
import { Tier, Sensitivity, ToolClass } from '../src/types.js';
import { STARTER_PACKS } from '../src/policy/engine.js';

// --- Finding 1 (critical): the MCP gateway must forward the MEDIATED payload, not the raw call ---
test('fix1: an ALLOWed call through the MCP gateway reaches upstream WITHOUT redacted fields', async () => {
  ars.register({ id: 'fix-reader', name: 'Reader', owner: 'ops@acme.corp', approved: true, tier: Tier.PRODUCTION,
    toolClasses: [ToolClass.READ], clearance: Sensitivity.INTERNAL, egressScope: 'internal-only' });

  let forwarded = null;
  const upstream = async (call) => { forwarded = call; return { content: [{ type: 'text', text: 'ok' }] }; };
  const mapToolCall = (tc) => ({
    dotId: 'fix-reader', taskType: 'read_report', tool: 'read_file', datasets: ['payroll.csv'],
    payload: { employee_name: 'Jane', department: 'Engineering', salary: 184000, ssn: '111-22-3333' },
    args: tc.arguments,
  });
  const gw = createMcpGateway({ upstream, mapToolCall });

  // the agent's raw call even tries to carry the restricted values
  const res = await gw.callTool({ name: 'read_file', arguments: { salary: 184000, ssn: '111-22-3333', note: 'keep-me' } });
  assert.ok(res.spine && res.spine.decision === 'ALLOW');
  assert.ok(forwarded, 'ALLOW must still forward');
  assert.equal('salary' in forwarded.arguments, false, 'upstream must NOT receive salary');
  assert.equal('ssn' in forwarded.arguments, false, 'upstream must NOT receive ssn');
  assert.equal(forwarded.arguments.department, 'Engineering'); // cleared field present
  assert.equal(forwarded.arguments.note, 'keep-me'); // non-data arg preserved
});

// --- Finding 3: URL allowlist must match by host, not raw string prefix ---
test('fix3: an allowlisted webhook prefix (no trailing slash) does NOT approve a lookalike domain', () => {
  const allow = { domains: ['acme.corp'], urls: ['https://hooks.acme.corp'] }; // reviewer's exact case
  assert.equal(classifyRecipient('https://hooks.acme.corp/team', allow), 'internal');
  assert.equal(classifyRecipient('https://hooks.acme.corp.evil.com', allow), 'external'); // the bug: startsWith matched
  assert.equal(classifyRecipient('https://hooks.acme.corp.evil.com/x', allow), 'external');
});

// --- Finding 4: starter packs must actually fire through handle() with an enriched context ---
test('fix4: under the finance pack, an internal transfer_funds needs approval (not a silent ALLOW)', async () => {
  ars.register({ id: 'fix-fin', name: 'Fin', owner: 'cfo@acme.corp', approved: true, tier: Tier.PRODUCTION,
    toolClasses: [ToolClass.READ, ToolClass.MONEY], clearance: Sensitivity.INTERNAL, egressScope: 'internal-only' });
  const d = await handle(
    { dotId: 'fix-fin', taskType: 'pay_vendor', tool: 'transfer_funds', recipient: 'vendor@acme.corp',
      datasets: [], args: { amount: 5000 } },
    { policy: STARTER_PACKS.finance, egressAllowlist: { domains: ['acme.corp'] } },
  );
  assert.notEqual(d.decision, 'ALLOW', `finance pack must not silently allow a transfer — got ${d.decision}`);
  // prove the finance pack actually fired (needs opts.policy wired + `tool` in the policy context)
  assert.match(d.reasons.join(' '), /fin-/, 'a finance-pack rule must appear in the reasons');
});

// --- Finding 5: CRI + ACS must use the authoritative `external` flag, not the old isExternal regex ---
import * as cri from '../src/layers/cri.js';
import * as acs from '../src/layers/acs.js';

test('fix5: CRI scores external egress from the passed flag (recipient the old regex missed)', () => {
  const ext = cri.score({ toolClass: ToolClass.EGRESS, sensitivity: Sensitivity.RESTRICTED, reversibility: 'irreversible', external: true });
  const int = cri.score({ toolClass: ToolClass.EGRESS, sensitivity: Sensitivity.RESTRICTED, reversibility: 'irreversible', external: false });
  assert.ok(ext.score > int.score, 'external must add risk');
  assert.ok(ext.factors.some((f) => /external/i.test(f.name)));
  assert.ok(!int.factors.some((f) => /external/i.test(f.name)));
});

test('fix5: ACS flags an external recipient using the authoritative flag (corp.evil.com)', () => {
  const r = acs.check({ action: { recipient: 'a@corp.evil.com' }, dot: { egressScope: 'internal-only' }, risk: {}, external: true });
  assert.ok(r.objections.some((o) => /outside|external|scope/i.test(o.note)));
  assert.equal(r.blocking, true);
});

// --- Finding 2: the audit signing key must persist across restarts (loadable) ---
import { loadOrCreateKey } from '../src/layers/ags.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('fix2: the signing key is stable across "restarts" when a key path is provided', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spine-key-'));
  const k1 = loadOrCreateKey(dir); // first start: generates + persists
  const k2 = loadOrCreateKey(dir); // restart: loads the SAME key
  const pem = (k) => k.publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal(pem(k1), pem(k2), 'the public key must be identical across restarts');
});
