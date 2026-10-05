# MCP gateway adapter

SPINE-dots can sit in front of **any MCP-speaking runtime** (Claude, OpenAI Agents SDK, LangGraph,
…) as a proxy: the agent connects to SPINE, SPINE governs every tool call, and only **ALLOW**ed
calls are forwarded to the real MCP server. One integration, no per-runtime code.

```js
import { createMcpGateway } from 'spine-dots';

const gateway = createMcpGateway({
  // forward an approved call to the real MCP server/tool
  upstream: (toolCall) => realMcpClient.callTool(toolCall),

  // map an MCP tool call -> a SPINE Action. The operator supplies this, so SPINE's task type,
  // datasets and clearance are NEVER taken from the agent's own words.
  mapToolCall: (toolCall) => ({
    dotId: currentDotId,
    taskType: 'send_report',          // operator/workflow-assigned enum (not free text)
    tool: toolCall.name,
    args: toolCall.arguments,
    recipient: toolCall.arguments?.to,
    datasets: datasetsFor(toolCall),
    payload: payloadFor(toolCall),    // the data being acted on (GDS mediates + DLP-scans it)
  }),

  handleOpts: { egressAllowlist: { domains: ['acme.corp'] } },
});

// In your MCP server's tools/call handler:
const result = await gateway.callTool(toolCall);
// result.spine = { decision, reasons, auditId, risk }
// ALLOW  -> the real tool's result (+ result.spine)
// BLOCK  -> { isError: true, content: [...], spine } — the real tool is never called
```

**Transport.** `callTool` is the integration point; wrap it in your MCP server's `tools/call`
handler (stdio or HTTP JSON-RPC). The decision service (`/v1/decide`) and a standalone proxy binary
are on the v1.0 roadmap — see [SPEC.md](../SPEC.md).
