// ACS — Adversarial Coordination Spine.
// Separation of duties: the maker Dot proposes, a DIFFERENT checker reviews. The checker's only job
// is to find reasons NOT to do it. Here the checker is rule-based so the demo is deterministic and
// runs offline; `llmCheck` is the hook where a real deployment spawns a separate OpenDots "checker
// Dot" with no shared context and an adversarial prompt.
import { ToolClass, Reversibility } from '../types.js';

/**
 * @param {{action, dot, risk, gds}} ctx
 * @returns {{objections:{severity:string, note:string}[], blocking:boolean, checker:string}}
 */
export function check(ctx) {
  const { action, dot, risk, gds } = ctx;
  const objections = [];
  const flag = (severity, note) => objections.push({ severity, note });

  if (ctx.external)
    flag('high', `recipient ${action.recipient} is OUTSIDE the org — confirm this data is cleared to leave`);

  if (gds?.redacted?.length)
    flag('high', `this action touches ${gds.redacted.length} field(s) above the Dot's clearance (${gds.redacted.map((r) => `${r.dataset}.${r.field}`).join(', ')}) — GDS redacted them, but the intent to read them is a red flag`);

  if (ctx.external && dot.egressScope === 'internal-only')
    flag('critical', `the Dot's Spine-Gate grant is internal-only, yet it is attempting an external send — scope violation`);

  if (ctx.toolClass === ToolClass.MONEY && ctx.reversibility === Reversibility.IRREVERSIBLE)
    flag('critical', `irreversible money movement — a second human sign-off is mandatory`);

  if (risk?.band === 'critical' && objections.length === 0)
    flag('medium', `risk is rated critical (${risk.score}) with no obvious single cause — review the factor breakdown before approving`);

  const blocking = objections.some((o) => o.severity === 'critical' || o.severity === 'high');
  return { objections, blocking, checker: 'acs-rule-checker@v1' };
}

const ADVERSARIAL_PROMPT =
  'You are an adversarial reviewer with NO shared context with the maker. Find every reason this agent ' +
  'action should NOT proceed. Be specific. Return {objections:[{severity,note}], blocking:boolean}.';

/** Resolve a promise or reject after `ms` — used to fail closed on a hung checker. */
function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`checker timeout after ${ms}ms`)), ms); });
  return Promise.race([Promise.resolve(promise), timer]).finally(() => clearTimeout(t));
}

/**
 * Run a separate checker Dot (own context, adversarial prompt, possibly a different model provider)
 * and judge the action — FAIL CLOSED: a timeout, a throw, or a malformed verdict all become a
 * blocking objection. The checker's identity is recorded with the verdict. Falls back to the
 * deterministic reference rule-checker when no client is supplied.
 * @param {Object} ctx
 * @param {{id?:string, review:Function}} [client]
 * @param {{timeoutMs?:number}} [opts]
 */
export async function llmCheck(ctx, client, opts = {}) {
  if (!client) return check(ctx);
  const timeoutMs = opts.timeoutMs ?? 8000;
  const checkerId = client.id ?? 'acs-llm-checker';
  let verdict;
  try {
    verdict = await withTimeout(
      client.review({ instruction: ADVERSARIAL_PROMPT, action: ctx.action, risk: ctx.risk, redactions: ctx.gds?.redacted ?? [] }),
      timeoutMs,
    );
  } catch (e) {
    const note = /timeout/i.test(e.message)
      ? `ACS checker timed out after ${timeoutMs}ms — failing closed`
      : `ACS checker errored (${e.message}) — failing closed`;
    return { objections: [{ severity: 'critical', note }], blocking: true, checker: checkerId, failedClosed: true };
  }
  if (!verdict || typeof verdict !== 'object' || !Array.isArray(verdict.objections) || typeof verdict.blocking !== 'boolean') {
    return { objections: [{ severity: 'critical', note: 'ACS checker returned a malformed verdict — failing closed' }], blocking: true, checker: verdict?.checker ?? checkerId, failedClosed: true };
  }
  return { objections: verdict.objections, blocking: verdict.blocking, checker: verdict.checker ?? checkerId };
}
