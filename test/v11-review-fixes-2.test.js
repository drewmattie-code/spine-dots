// v0.11 — second review round. Each test is a RED repro of a real finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpGateway } from '../src/mcp/gateway.js';
import { classifyRecipient } from '../src/egress.js';
import { handle } from '../src/gateway.js';
import * as ars from '../src/layers/ars.js';
import { Tier, Sensitivity, ToolClass } from '../src/types.js';
import { STARTER_PACKS } from '../src/policy/engine.js';

// --- Regression 1: a loaded pack must NOT drop the base forbid rules ---
test('r1: a starter pack cannot approve a tool the Dot was never granted (base forbids still apply)', async () => {
  // Dot has NO money permission; pay_vendor task type lists transfer_funds, but the Dot lacks the MONEY class.
  ars.register({ id: 'r1-dot', name: 'r1', owner: 'cfo@acme.corp', approved: true, tier: Tier.PRODUCTION,
    toolClasses: [ToolClass.READ], clearance: Sensitivity.INTERNAL, egressScope: 'internal-only' });
  const d = await handle(
    { dotId: 'r1-dot', taskType: 'pay_vendor', tool: 'transfer_funds', recipient: 'vendor@acme.corp', datasets: [], args: { amount: 5000 } },
    { policy: STARTER_PACKS.finance, egressAllowlist: { domains: ['acme.corp'] } },
  );
  assert.equal(d.decision, 'BLOCK', `a non-permitted tool must BLOCK, not become one click — got ${d.decision}`);
});

// --- Partial fix 2a: nested arguments must be deep-stripped of redacted fields ---
function readerDot(id) {
  ars.register({ id, name: id, owner: 'ops@acme.corp', approved: true, tier: Tier.PRODUCTION,
    toolClasses: [ToolClass.READ], clearance: Sensitivity.INTERNAL, egressScope: 'internal-only' });
}
const PAYLOAD = { employee_name: 'Jane', department: 'Engineering', salary: 184000, ssn: '111-22-3333' };

test('r2a: redacted fields are stripped from NESTED arguments (arguments.row.ssn)', async () => {
  readerDot('r2a-dot');
  let fwd = null;
  const gw = createMcpGateway({
    upstream: async (c) => { fwd = c; return { content: [] }; },
    mapToolCall: () => ({ dotId: 'r2a-dot', taskType: 'read_report', tool: 'read_file', datasets: ['payroll.csv'], payload: PAYLOAD }),
  });
  await gw.callTool({ name: 'read_file', arguments: { row: { department: 'Engineering', salary: 184000, ssn: '111-22-3333' }, note: 'keep' } });
  assert.equal('ssn' in fwd.arguments.row, false, 'nested ssn must be stripped');
  assert.equal('salary' in fwd.arguments.row, false, 'nested salary must be stripped');
  assert.equal(fwd.arguments.row.department, 'Engineering');
  assert.equal(fwd.arguments.note, 'keep');
  assert.equal('salary' in fwd.arguments, false, 'must not copy cleaned fields to the top level (no shape change)');
});

// --- Partial fix 2b: strip by field name even when mapToolCall provides no payload ---
test('r2b: redacted field NAMES are stripped even when the mapping passes no payload', async () => {
  readerDot('r2b-dot');
  let fwd = null;
  const gw = createMcpGateway({
    upstream: async (c) => { fwd = c; return { content: [] }; },
    mapToolCall: () => ({ dotId: 'r2b-dot', taskType: 'read_report', tool: 'read_file', datasets: ['payroll.csv'] }), // no payload
  });
  await gw.callTool({ name: 'read_file', arguments: { salary: 184000, ssn: '111-22-3333', department: 'Engineering' } });
  assert.equal('ssn' in fwd.arguments, false);
  assert.equal('salary' in fwd.arguments, false);
  assert.equal(fwd.arguments.department, 'Engineering');
});

// --- Minor: URL path prefix must match at a path boundary ---
test('r3: an allowlisted URL path matches at a boundary (/in does not match /inbox-evil)', () => {
  const allow = { domains: [], urls: ['https://api.acme.io/in'] };
  assert.equal(classifyRecipient('https://api.acme.io/in', allow), 'internal');
  assert.equal(classifyRecipient('https://api.acme.io/in/hook', allow), 'internal');
  assert.equal(classifyRecipient('https://api.acme.io/inbox-evil', allow), 'external');
});
