// v0.13 — OpenAI-compatible tool-call proxy. One adapter governs any model that speaks the OpenAI
// chat-completions tool-call format: Grok (xAI), Qwen/Kimi/Llama behind LiteLLM or vLLM, OpenAI itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { governCompletion, createOpenAIProxy } from '../src/openai/proxy.js';
import * as ars from '../src/layers/ars.js';
import { Tier, Sensitivity, ToolClass } from '../src/types.js';
import { setupFinanceDot, DEMO_EGRESS_ALLOWLIST } from '../demo/setup.js';

function readerDot(id) {
  ars.register({ id, name: id, owner: 'ops@acme.corp', approved: true, tier: Tier.PRODUCTION,
    toolClasses: [ToolClass.READ], clearance: Sensitivity.INTERNAL, egressScope: 'internal-only' });
}

function completion(toolCalls, content = null) {
  return {
    id: 'chatcmpl-1', object: 'chat.completion', model: 'grok-test',
    choices: [{ index: 0, finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
      message: { role: 'assistant', content, tool_calls: toolCalls } }],
  };
}
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });

// Operator mapping: task type and datasets come from the operator, never from the model's words.
const MAP = {
  read_file: (args) => ({ dotId: 'oa-reader', taskType: 'read_report', tool: 'read_file', datasets: ['payroll.csv'], args }),
  send_email: (args) => ({ dotId: 'finance-dot', taskType: 'send_report', tool: 'send_email', recipient: args.to,
    datasets: ['payroll.csv'], payload: { salary: 184000, ssn: '111-22-3333', department: 'Engineering' },
    args: { subject: args.subject, body: args.body } }),
};
const mapToolCall = ({ name, arguments: args }) => MAP[name](args);

test('ALLOW: an approved tool call passes through with its arguments and SPINE metadata', async () => {
  readerDot('oa-reader');
  const out = await governCompletion(completion([call('c1', 'read_file', { path: 'q3.csv' })]), { mapToolCall });
  const msg = out.choices[0].message;
  assert.equal(msg.tool_calls.length, 1);
  assert.deepEqual(JSON.parse(msg.tool_calls[0].function.arguments), { path: 'q3.csv' });
  assert.equal(out.choices[0].finish_reason, 'tool_calls');
  assert.equal(out.spine[0].decision, 'ALLOW');
  assert.equal(out.spine[0].toolCallId, 'c1');
  assert.ok(out.spine[0].auditId !== undefined);
});

test('BLOCK: a governed tool call is removed, so the client never receives it', async () => {
  setupFinanceDot();
  const out = await governCompletion(
    completion([call('c2', 'send_email', { to: 'accounts@vendor-supplier.com', subject: 'Q3 payroll', body: 'total 184000, ssn 111-22-3333' })]),
    { mapToolCall, handleOpts: { egressAllowlist: DEMO_EGRESS_ALLOWLIST } },
  );
  const choice = out.choices[0];
  assert.equal(choice.message.tool_calls, undefined, 'blocked call must not reach the client');
  assert.equal(choice.finish_reason, 'stop', 'with nothing left to execute, the turn ends');
  assert.match(choice.message.content, /SPINE-dots BLOCK/);
  assert.equal(out.spine[0].decision, 'BLOCK');
});

test('mixed: only the allowed call survives; finish_reason stays tool_calls', async () => {
  readerDot('oa-reader');
  setupFinanceDot();
  const out = await governCompletion(completion([
    call('ok', 'read_file', { path: 'q3.csv' }),
    call('bad', 'send_email', { to: 'x@vendor-supplier.com', subject: 's', body: 'ssn 111-22-3333' }),
  ]), { mapToolCall, handleOpts: { egressAllowlist: DEMO_EGRESS_ALLOWLIST } });
  const msg = out.choices[0].message;
  assert.deepEqual(msg.tool_calls.map((t) => t.id), ['ok']);
  assert.equal(out.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(out.spine.map((s) => s.decision), ['ALLOW', 'BLOCK']);
});

test('mediation: over-clearance field names are deep-stripped from ALLOWed arguments', async () => {
  readerDot('oa-reader');
  const out = await governCompletion(
    completion([call('m', 'read_file', { row: { department: 'Engineering', salary: 184000, ssn: '111-22-3333' }, note: 'keep' })]),
    { mapToolCall },
  );
  const args = JSON.parse(out.choices[0].message.tool_calls[0].function.arguments);
  assert.equal('ssn' in args.row, false);
  assert.equal('salary' in args.row, false);
  assert.equal(args.row.department, 'Engineering');
  assert.equal(args.note, 'keep');
});

test('fail closed: malformed JSON arguments BLOCK (never forwarded unparsed)', async () => {
  readerDot('oa-reader');
  const out = await governCompletion(completion([call('j', 'read_file', '{"path": "q3.csv"')]), { mapToolCall });
  assert.equal(out.choices[0].message.tool_calls, undefined);
  assert.equal(out.spine[0].decision, 'BLOCK');
  assert.match(out.spine[0].reasons.join(' '), /arguments/i);
});

test('fail closed: a mapping error or unknown tool BLOCKs', async () => {
  const out = await governCompletion(completion([call('u', 'delete_everything', {})]), { mapToolCall });
  assert.equal(out.choices[0].message.tool_calls, undefined);
  assert.equal(out.spine[0].decision, 'BLOCK');
});

test('no tool calls: the completion is returned unchanged (plus an empty spine list)', async () => {
  const c = completion([], 'hello');
  delete c.choices[0].message.tool_calls;
  const out = await governCompletion(c, { mapToolCall });
  assert.equal(out.choices[0].message.content, 'hello');
  assert.deepEqual(out.spine, []);
});

test('governCompletion never mutates the upstream response object', async () => {
  setupFinanceDot();
  const c = completion([call('c2', 'send_email', { to: 'a@vendor-supplier.com', subject: 's', body: 'b' })]);
  const before = JSON.stringify(c);
  await governCompletion(c, { mapToolCall, handleOpts: { egressAllowlist: DEMO_EGRESS_ALLOWLIST } });
  assert.equal(JSON.stringify(c), before);
});

// ---- HTTP proxy ----
async function withProxy(cfg, fn) {
  const proxy = createOpenAIProxy(cfg);
  const server = await proxy.listen(0);
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); } finally { await new Promise((r) => server.close(r)); }
}

test('HTTP: POST /v1/chat/completions is forwarded upstream and the response is governed', async () => {
  setupFinanceDot();
  let upstreamReq = null;
  const fakeFetch = async (url, init) => {
    upstreamReq = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify(completion([call('c2', 'send_email', { to: 'a@vendor-supplier.com', subject: 's', body: 'b' })])),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await withProxy({ upstream: { baseURL: 'https://api.x.ai/v1', apiKey: 'xai-secret', fetch: fakeFetch }, mapToolCall,
    handleOpts: { egressAllowlist: DEMO_EGRESS_ALLOWLIST } }, async (base) => {
    const res = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer client-key' },
      body: JSON.stringify({ model: 'grok-4', messages: [{ role: 'user', content: 'send payroll' }], tools: [] }) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.choices[0].message.tool_calls, undefined, 'blocked call stripped over HTTP too');
    assert.equal(body.spine[0].decision, 'BLOCK');
  });
  assert.equal(upstreamReq.url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(upstreamReq.init.headers.authorization, 'Bearer xai-secret', 'operator key is used, not the client key');
  assert.equal(upstreamReq.body.model, 'grok-4');
});

test('HTTP: stream:true is refused (no ungoverned stream reaches the client)', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; return new Response('{}'); };
  await withProxy({ upstream: { baseURL: 'http://u/v1', fetch: fakeFetch }, mapToolCall }, async (base) => {
    const res = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', messages: [], stream: true }) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /stream/i);
  });
  assert.equal(called, false);
});

test('HTTP: upstream errors are passed back with their status; unknown routes 404', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429, headers: { 'content-type': 'application/json' } });
  await withProxy({ upstream: { baseURL: 'http://u/v1', fetch: fakeFetch }, mapToolCall }, async (base) => {
    const r1 = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm', messages: [] }) });
    assert.equal(r1.status, 429);
    const r2 = await fetch(`${base}/v1/embeddings`, { method: 'POST', body: '{}' });
    assert.equal(r2.status, 404);
  });
});

test('createOpenAIProxy requires upstream.baseURL and mapToolCall', () => {
  assert.throws(() => createOpenAIProxy({ mapToolCall }));
  assert.throws(() => createOpenAIProxy({ upstream: { baseURL: 'http://u/v1' } }));
});

test('package barrel exports the OpenAI proxy', async () => {
  const api = await import('../index.js');
  assert.equal(typeof api.governCompletion, 'function');
  assert.equal(typeof api.createOpenAIProxy, 'function');
});

test('legacy function_call field is governed too (no bypass via the old format)', async () => {
  setupFinanceDot();
  const c = { id: 'x', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'function_call',
    message: { role: 'assistant', content: null, function_call: { name: 'send_email',
      arguments: JSON.stringify({ to: 'a@vendor-supplier.com', subject: 's', body: 'b' }) } } }] };
  const out = await governCompletion(c, { mapToolCall, handleOpts: { egressAllowlist: DEMO_EGRESS_ALLOWLIST } });
  assert.equal(out.choices[0].message.function_call, undefined, 'blocked legacy call must be removed');
  assert.equal(out.choices[0].finish_reason, 'stop');
  assert.equal(out.spine[0].decision, 'BLOCK');
});

test('arguments sent as an object (some servers) are governed, and keep their object shape', async () => {
  readerDot('oa-reader');
  const tc = { id: 'o', type: 'function', function: { name: 'read_file', arguments: { row: { department: 'Eng', ssn: '111-22-3333' } } } };
  const out = await governCompletion(completion([tc]), { mapToolCall });
  const args = out.choices[0].message.tool_calls[0].function.arguments;
  assert.equal(typeof args, 'object');
  assert.equal('ssn' in args.row, false);
  assert.equal(out.spine[0].decision, 'ALLOW');
});
