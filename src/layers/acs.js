// ACS — Adversarial Coordination Spine.
// Separation of duties: the maker Dot proposes, a DIFFERENT checker reviews. The checker's only job
// is to find reasons NOT to do it. Here the checker is rule-based so the demo is deterministic and
// runs offline; `llmCheck` is the hook where a real deployment spawns a separate OpenDots "checker
// Dot" with no shared context and an adversarial prompt.
import { ToolClass, Reversibility, isExternal } from '../types.js';

/**
 * @param {{action, dot, risk, gds}} ctx
 * @returns {{objections:{severity:string, note:string}[], blocking:boolean, checker:string}}
 */
export function check(ctx) {
  const { action, dot, risk, gds } = ctx;
  const objections = [];
  const flag = (severity, note) => objections.push({ severity, note });

  if (action.recipient && isExternal(action.recipient))
    flag('high', `recipient ${action.recipient} is OUTSIDE the org — confirm this data is cleared to leave`);

  if (gds?.redacted?.length)
    flag('high', `this action touches ${gds.redacted.length} field(s) above the Dot's clearance (${gds.redacted.map((r) => `${r.dataset}.${r.field}`).join(', ')}) — GDS redacted them, but the intent to read them is a red flag`);

  if (action.recipient && isExternal(action.recipient) && dot.egressScope === 'internal-only')
    flag('critical', `the Dot's Spine-Gate grant is internal-only, yet it is attempting an external send — scope violation`);

  if (ctx.toolClass === ToolClass.MONEY && ctx.reversibility === Reversibility.IRREVERSIBLE)
    flag('critical', `irreversible money movement — a second human sign-off is mandatory`);

  if (risk?.band === 'critical' && objections.length === 0)
    flag('medium', `risk is rated critical (${risk.score}) with no obvious single cause — review the factor breakdown before approving`);

  const blocking = objections.some((o) => o.severity === 'critical' || o.severity === 'high');
  return { objections, blocking, checker: 'acs-rule-checker@v1' };
}

/**
 * Production hook: spawn a separate checker Dot (own container, no shared memory) with an adversarial
 * system prompt and have it judge the action. Wire this to your OpenDots runtime. Falls back to
 * rule-based `check` if no client is provided.
 */
export async function llmCheck(ctx, client) {
  if (!client) return check(ctx);
  const verdict = await client.review({
    instruction: 'You are an adversarial reviewer. Find every reason this agent action should NOT proceed. Be specific. Return objections with severity.',
    action: ctx.action, risk: ctx.risk, redactions: ctx.gds?.redacted ?? [],
  });
  return { objections: verdict.objections ?? [], blocking: !!verdict.blocking, checker: verdict.checker ?? 'acs-llm-checker' };
}
