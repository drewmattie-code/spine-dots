// OpenAI-compatible tool-call proxy — SPINE-dots in front of any model that speaks the OpenAI
// chat-completions format (Grok/xAI, OpenAI, and open models served by LiteLLM, vLLM, Ollama, ...).
// The proxy forwards the chat request upstream, then governs every tool call the model asks for:
// ALLOW passes through with over-clearance fields stripped from its arguments; BLOCK / NEEDS_APPROVAL
// removes the call, so the client never receives (and never executes) it. Fails closed throughout.
//
// Scope, stated plainly: this governs what the model is allowed to ASK for. Your app must execute only
// the tool calls it receives through the proxy. Streaming is refused (not yet governed).
import http from 'node:http';
import { handle } from '../gateway.js';
import { deepStripKeys, stripKeysFor } from '../mediate.js';

function blocked(reason) {
  return { decision: 'BLOCK', reasons: [reason], logId: null, risk: null };
}

async function governToolCall(tc, mapToolCall, handleOpts) {
  // Most servers send arguments as a JSON string; some send an object. Govern both, keep the shape.
  const rawArgs = tc.function?.arguments ?? '{}';
  const argsWereObject = typeof rawArgs === 'object';
  let args;
  try {
    args = argsWereObject ? rawArgs : JSON.parse(rawArgs);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('not an object');
  } catch {
    return { decision: blocked('tool call arguments are not a valid JSON object') };
  }
  let action;
  try {
    action = mapToolCall({ id: tc.id, name: tc.function?.name, arguments: args });
    if (!action || typeof action !== 'object') throw new Error('no action');
  } catch (e) {
    return { decision: blocked(`no SPINE mapping for tool "${tc.function?.name}" (${e.message})`) };
  }
  let decision;
  try {
    decision = await handle(action, handleOpts);
  } catch (e) {
    return { decision: blocked(`governance error: ${e.message}`) };
  }
  if (decision.decision !== 'ALLOW') return { decision };
  const mediatedArgs = deepStripKeys(args, stripKeysFor(action, decision));
  const outArgs = argsWereObject ? mediatedArgs : JSON.stringify(mediatedArgs);
  return { decision, call: { ...tc, function: { ...tc.function, arguments: outArgs } } };
}

function record(out, tc, decision) {
  out.spine.push({ toolCallId: tc.id ?? null, tool: tc.function?.name, decision: decision.decision,
    reasons: decision.reasons, auditId: decision.logId, risk: decision.risk });
  return decision.decision === 'ALLOW' ? null : `SPINE-dots ${decision.decision} on ${tc.function?.name}: ${decision.reasons.join('; ')}`;
}

/**
 * Govern the tool calls in an OpenAI chat.completion response. Returns a new object (never mutates).
 * @param {Object} completion  upstream chat.completion JSON
 * @param {Object} cfg
 * @param {({id, name, arguments}) => Object} cfg.mapToolCall  operator mapping to a SPINE Action
 * @param {Object} [cfg.handleOpts]  opts passed to handle()
 * @returns {Promise<Object>} the governed completion, with `spine`: one entry per tool call
 */
export async function governCompletion(completion, { mapToolCall, handleOpts = {} } = {}) {
  const out = structuredClone(completion);
  out.spine = [];
  for (const choice of out.choices ?? []) {
    const msg = choice.message;
    if (!msg) continue;
    const notes = [];
    let remaining = 0;

    const calls = msg.tool_calls;
    if (Array.isArray(calls) && calls.length) {
      const kept = [];
      for (const tc of calls) {
        const { decision, call } = await governToolCall(tc, mapToolCall, handleOpts);
        const note = record(out, tc, decision);
        if (call) kept.push(call); else notes.push(note);
      }
      if (kept.length) msg.tool_calls = kept; else delete msg.tool_calls;
      remaining += kept.length;
    }

    // Legacy single-call format (message.function_call). Governed the same way, so the old field is no bypass.
    if (msg.function_call) {
      const tc = { id: null, function: msg.function_call };
      const { decision, call } = await governToolCall(tc, mapToolCall, handleOpts);
      const note = record(out, tc, decision);
      if (call) { msg.function_call = call.function; remaining += 1; } else { delete msg.function_call; notes.push(note); }
    }

    if (notes.length) {
      if (remaining === 0) choice.finish_reason = 'stop';
      msg.content = [msg.content, ...notes].filter(Boolean).join('\n');
    }
  }
  return out;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * HTTP proxy exposing POST /v1/chat/completions. Point any OpenAI-compatible client's base URL at it.
 * @param {Object} cfg
 * @param {Object} cfg.upstream  { baseURL, apiKey?, fetch? } — the real endpoint (e.g. https://api.x.ai/v1).
 *        If apiKey is set it replaces the client's Authorization header; otherwise the client's is passed on.
 * @param {Function} cfg.mapToolCall
 * @param {Object} [cfg.handleOpts]
 */
export function createOpenAIProxy(cfg = {}) {
  const { upstream = {}, mapToolCall, handleOpts = {} } = cfg;
  if (!upstream.baseURL) throw new Error('createOpenAIProxy: `upstream.baseURL` is required');
  if (typeof mapToolCall !== 'function') throw new Error('createOpenAIProxy: `mapToolCall` must be a function');
  const doFetch = upstream.fetch ?? fetch;
  const base = upstream.baseURL.replace(/\/+$/, '');

  async function handler(req, res) {
    try {
      const path = req.url.split('?')[0].replace(/\/+$/, '');
      if (req.method !== 'POST' || !/^(\/v1)?\/chat\/completions$/.test(path)) {
        return sendJson(res, 404, { error: { message: 'SPINE-dots proxy: only POST /v1/chat/completions is supported' } });
      }
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body;
      try { body = JSON.parse(raw); } catch { return sendJson(res, 400, { error: { message: 'request body is not valid JSON' } }); }
      if (body.stream) return sendJson(res, 400, { error: { message: 'SPINE-dots proxy: stream:true is not supported yet; send stream:false' } });

      const auth = upstream.apiKey ? `Bearer ${upstream.apiKey}` : req.headers.authorization;
      const up = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
        body: JSON.stringify(body),
      });
      const text = await up.text();
      if (!up.ok) {
        res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'application/json' });
        return res.end(text);
      }
      let completion;
      try { completion = JSON.parse(text); } catch { return sendJson(res, 502, { error: { message: 'upstream returned non-JSON' } }); }
      return sendJson(res, 200, await governCompletion(completion, { mapToolCall, handleOpts }));
    } catch (e) {
      return sendJson(res, 502, { error: { message: `SPINE-dots proxy error: ${e.message}` } });
    }
  }

  return {
    handler,
    listen(port = 8787, host = '127.0.0.1') {
      const server = http.createServer(handler);
      return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
    },
  };
}
