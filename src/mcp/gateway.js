// MCP gateway — SPINE-dots as a proxy in front of any MCP-speaking runtime.
// An agent's tool calls are routed through here: each call is mapped to a SPINE Action, governed by
// handle(), and ONLY forwarded to the real MCP server when the decision is ALLOW. A BLOCK or
// NEEDS_APPROVAL returns an MCP-style error result instead of reaching the tool — so the leak never
// happens. One integration covers Claude, the OpenAI Agents SDK, LangGraph, and anything else that
// speaks MCP, with no per-runtime code. Transport (stdio / HTTP JSON-RPC) wraps this core.
import { handle } from '../gateway.js';

/**
 * @param {Object} cfg
 * @param {(toolCall) => Promise<any>} cfg.upstream     forwards an approved call to the real MCP server
 * @param {(toolCall) => Object} cfg.mapToolCall        maps an MCP tool call to a SPINE Action
 *        (dotId, taskType, tool, args, datasets, recipient, payload). The operator supplies this so
 *        SPINE's task type / clearance / datasets are never taken from the agent's own words.
 * @param {Object} [cfg.handleOpts]                     opts passed to handle() (egressAllowlist, taskTypes, ...)
 * @returns {{ callTool: (toolCall) => Promise<any> }}
 */
export function createMcpGateway(cfg = {}) {
  const { upstream, mapToolCall, handleOpts = {} } = cfg;
  if (typeof upstream !== 'function') throw new Error('createMcpGateway: `upstream` must be a function');
  if (typeof mapToolCall !== 'function') throw new Error('createMcpGateway: `mapToolCall` must be a function');

  return {
    async callTool(toolCall) {
      const action = mapToolCall(toolCall);
      const decision = await handle(action, handleOpts);
      const spine = { decision: decision.decision, reasons: decision.reasons, auditId: decision.logId, risk: decision.risk };

      if (decision.decision === 'ALLOW') {
        const result = await upstream(toolCall);
        // attach the governance receipt alongside the tool's own result
        return (result && typeof result === 'object') ? { ...result, spine } : { content: [{ type: 'text', text: String(result) }], spine };
      }

      // BLOCK / NEEDS_APPROVAL: do not forward. Return an MCP tool-error result.
      return {
        isError: true,
        content: [{ type: 'text', text: `SPINE-dots ${decision.decision}: ${decision.reasons.join('; ')}` }],
        spine,
      };
    },
  };
}
