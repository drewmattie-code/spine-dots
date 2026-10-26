// Shared mediation helpers for the proxies (MCP gateway, OpenAI proxy): remove over-clearance data
// from a tool call's arguments before it is forwarded.

/** Return a deep clone of `value` with any key in `keys` removed at every depth. Never mutates input. */
export function deepStripKeys(value, keys) {
  if (Array.isArray(value)) return value.map((v) => deepStripKeys(v, keys));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (keys.has(k)) continue;
      out[k] = deepStripKeys(v, keys);
    }
    return out;
  }
  return value;
}

/**
 * Field names to strip from an ALLOWed call: the redacted FIELD NAMES from the GDS catalog for the
 * declared datasets, plus any payload key the mediated payload dropped. Stripping by name at every
 * depth catches nested values (arguments.row.ssn) and works even when the mapping passes no payload.
 */
export function stripKeysFor(action, decision) {
  const keys = new Set((decision.data?.redacted ?? []).map((r) => r.field));
  const mediated = decision.data?.mediatedPayload ?? {};
  for (const k of Object.keys(action.payload ?? {})) if (!(k in mediated)) keys.add(k);
  return keys;
}
