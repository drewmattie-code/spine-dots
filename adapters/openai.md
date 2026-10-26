# OpenAI-compatible proxy adapter (Grok, OpenAI, open models)

Most models now speak the OpenAI chat-completions tool-call format: **Grok (xAI)**, OpenAI, and open
models served by **LiteLLM, vLLM, Ollama or LM Studio** (Qwen, Llama, Kimi, gpt-oss, ...). One proxy
puts SPINE in front of all of them. Point your app's OpenAI base URL at the proxy instead of the
provider; SPINE governs every tool call the model asks for before your app sees it.

```js
import { createOpenAIProxy } from 'spine-dots';

const proxy = createOpenAIProxy({
  // the real endpoint. If apiKey is set it replaces the client's key (the app never holds it).
  upstream: { baseURL: 'https://api.x.ai/v1', apiKey: process.env.XAI_API_KEY },

  // map a tool call -> a SPINE Action. The operator supplies this, so SPINE's task type, datasets
  // and clearance are NEVER taken from the model's own words. Throwing here = BLOCK.
  mapToolCall: ({ name, arguments: args }) => ({
    dotId: 'finance-agent',
    taskType: 'send_report',
    tool: name,
    args,
    recipient: args.to,
    datasets: ['payroll.csv'],
  }),

  handleOpts: { egressAllowlist: { domains: ['acme.corp'] } },
});
await proxy.listen(8787);   // then: new OpenAI({ baseURL: 'http://127.0.0.1:8787/v1' })
```

What happens to each tool call in the model's response:

| Decision | What the app receives |
|---|---|
| **ALLOW** | the tool call, with over-clearance field names deep-stripped from its arguments |
| **BLOCK / NEEDS_APPROVAL** | nothing: the call is removed and a `SPINE-dots BLOCK ...` note is added to the message content. If no calls remain, `finish_reason` becomes `stop` |
| malformed JSON arguments, unmapped tool, governance error | **BLOCK** (fails closed) |
| legacy `message.function_call` | governed exactly like `tool_calls` (no bypass via the old format) |

Every response carries `spine: [{ toolCallId, tool, decision, reasons, auditId, risk }]`. OpenAI SDKs
ignore unknown fields, so existing clients keep working.

No HTTP server needed? Call `governCompletion(completion, { mapToolCall, handleOpts })` on a response
you already have.

**Scope, stated plainly.**
- This governs what the model is allowed to **ask for**. Your app must execute only the tool calls it
  receives through the proxy. If the app can call tools some other way, SPINE can't see that.
- `stream: true` is refused with a 400 until streaming is governed. Send `stream: false`.
- Only `POST /v1/chat/completions` is proxied.
- Tool calls the upstream server fails to parse (left as text in `content`, e.g. raw `<tool_call>` tags) are not governed. Use a server that returns structured `tool_calls`.

**Try it live** against any endpoint:

```bash
UPSTREAM_BASE_URL=https://api.x.ai/v1 UPSTREAM_API_KEY=xai-... MODEL=grok-4 node demo/openai-proxy.mjs
UPSTREAM_BASE_URL=http://localhost:11434/v1 MODEL=qwen3 node demo/openai-proxy.mjs   # Ollama
```

Verified 2026-10-26 against a local Qwen 3.8 27B (MLX server): the model asked to `send_email`
payroll to an outside address; SPINE blocked it and the app received no tool call.
