// v0.5 acceptance tests: the MCP gateway (SPINE in front of any MCP runtime) and package exports
// (fixes C11 — the import in the README actually resolves).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpGateway } from '../src/mcp/gateway.js';
import * as ars from '../src/layers/ars.js';
import { Tier, Sensitivity, ToolClass } from '../src/types.js';
import { setupFinanceDot } from '../demo/setup.js';

test('MCP gateway forwards an ALLOWed tool call to the upstream server and returns its result', async () => {
  ars.register({
    id: 'mcp-reader', name: 'Reader', owner: 'ops@acme.corp', approved: true, tier: Tier.PRODUCTION,
    toolClasses: [ToolClass.READ], clearance: Sensitivity.INTERNAL, egressScope: 'internal-only',
  });
  let forwarded = null;
  const upstream = async (call) => { forwarded = call; return { content: [{ type: 'text', text: 'upstream-ok' }] }; };
  const mapToolCall = () => ({ dotId: 'mcp-reader', taskType: 'read_report', tool: 'read_file', datasets: ['q3_summary.csv'] });
  const gw = createMcpGateway({ upstream, mapToolCall });

  const res = await gw.callTool({ name: 'read_file', arguments: {} });
  assert.equal(res.content[0].text, 'upstream-ok');
  assert.ok(forwarded, 'ALLOW must reach the real MCP server');
  assert.ok(res.spine && res.spine.decision === 'ALLOW');
});

test('MCP gateway BLOCKS a governed tool call and never forwards it to upstream', async () => {
  setupFinanceDot();
  let forwarded = false;
  const upstream = async () => { forwarded = true; return { content: [] }; };
  const mapToolCall = () => ({
    dotId: 'finance-dot', taskType: 'send_report', tool: 'send_email',
    recipient: 'accounts@vendor-supplier.com', datasets: ['payroll.csv'],
    payload: { salary: 184000, ssn: '111-22-3333', department: 'Engineering' },
    args: { subject: 'Q3 payroll', body: 'total 184000, ssn 111-22-3333' },
  });
  const gw = createMcpGateway({ upstream, mapToolCall });

  const res = await gw.callTool({ name: 'send_email', arguments: {} });
  assert.equal(forwarded, false, 'a blocked call must never reach the real tool');
  assert.equal(res.isError, true);
  assert.equal(res.spine.decision, 'BLOCK');
  assert.match(res.content[0].text, /BLOCK/);
});

test('MCP gateway requires an upstream and a mapToolCall', () => {
  assert.throws(() => createMcpGateway({ mapToolCall: () => ({}) }));
  assert.throws(() => createMcpGateway({ upstream: async () => ({}) }));
});

test('C11: the package exposes a public API barrel that re-exports the gateway + building blocks', async () => {
  const api = await import('../index.js');
  assert.equal(typeof api.handle, 'function');
  assert.equal(typeof api.createMcpGateway, 'function');
  assert.equal(typeof api.evaluatePolicy, 'function');
  assert.equal(typeof api.classifyRecipient, 'function');
  assert.ok(api.DEFAULT_POLICY && Array.isArray(api.DEFAULT_POLICY.rules));
});
