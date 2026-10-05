// Policy engine (fixes C9). Policy is DATA: a {version, rules[]} document where each rule is
// {id, when: "<expression>", effect: allow|require_approval|block, reason}. Rules are evaluated
// fail-closed (default-deny, deny-overrides) by the safe expression interpreter — no code in policy.
// Security teams read/diff/test/version/roll back policy without touching the engine.
import { evalExpr, compile } from './expr.js';

const EFFECTS = new Set(['allow', 'require_approval', 'block']);
const Decision = { ALLOW: 'ALLOW', NEEDS_APPROVAL: 'NEEDS_APPROVAL', BLOCK: 'BLOCK' };

/** Validate a policy document at load time. Throws on any structural or expression error. */
export function validatePolicy(policy) {
  if (!policy || typeof policy !== 'object' || !Array.isArray(policy.rules)) {
    throw new Error('policy must be an object { version, rules: [] }');
  }
  const ids = new Set();
  for (const r of policy.rules) {
    if (!r || typeof r.id !== 'string' || !r.id) throw new Error('each rule needs a non-empty string id');
    if (ids.has(r.id)) throw new Error(`duplicate rule id "${r.id}"`);
    ids.add(r.id);
    if (typeof r.when !== 'string') throw new Error(`rule "${r.id}": "when" must be a string expression`);
    if (!EFFECTS.has(r.effect)) throw new Error(`rule "${r.id}": "effect" must be allow | require_approval | block`);
    if (typeof r.reason !== 'string') throw new Error(`rule "${r.id}": "reason" must be a string`);
    try { compile(r.when); } catch (e) { throw new Error(`rule "${r.id}": invalid expression — ${e.message}`); }
  }
  return policy;
}

/**
 * Evaluate a JSON policy against a context, fail-closed.
 * @returns {{decision, ruleIds: string[], reasons: string[], policyVersion}}
 */
export function evaluatePolicy(ctx, policy) {
  const matched = [];
  for (const r of policy.rules) {
    let hit = false;
    try { hit = Boolean(evalExpr(r.when, ctx)); } catch { hit = false; } // malformed/eval error never matches
    if (hit) matched.push(r);
  }
  const has = (e) => matched.some((r) => r.effect === e);
  let decision;
  if (has('block')) decision = Decision.BLOCK;
  else if (has('require_approval')) decision = Decision.NEEDS_APPROVAL;
  else if (has('allow')) decision = Decision.ALLOW;
  else decision = Decision.BLOCK; // default deny
  const reasons = matched.map((r) => `${r.id}: ${r.reason}`);
  if (decision === Decision.BLOCK && !has('block')) reasons.push('default-deny: no rule explicitly allowed this action');
  return { decision, ruleIds: matched.map((r) => r.id), reasons, policyVersion: policy.version };
}

/** The default declarative policy — the same semantics as v0.2, now as data. */
export const DEFAULT_POLICY = Object.freeze({
  version: 'default-0.3.0',
  rules: [
    { id: 'forbid-unregistered',     when: '!registered',                                                 effect: 'block',            reason: 'Dot is not registered/approved in ARS' },
    { id: 'forbid-undiscovered',     when: '!toolAuthorized',                                             effect: 'block',            reason: 'tool was not granted by PDS for this task type' },
    { id: 'forbid-egress-scope',     when: 'external && egressScope != "external-allowed"',                effect: 'block',            reason: 'Dot egress scope is internal-only; external send denied by the Spine Gate grant' },
    { id: 'block-restricted-egress', when: 'external && peakSensitivity == "restricted"',                  effect: 'block',            reason: 'restricted data cannot leave the org' },
    { id: 'block-dlp-hit',           when: 'dlpHit',                                                      effect: 'block',            reason: 'outbound payload contains classified values above clearance (egress DLP)' },
    { id: 'approve-critical',        when: 'riskBand == "critical"',                                       effect: 'require_approval', reason: 'critical risk requires human approval + an ACS check' },
    { id: 'approve-high',            when: 'riskBand == "high"',                                           effect: 'require_approval', reason: 'high risk requires human approval + an ACS check' },
    { id: 'approve-acs-objection',   when: 'acsBlocking',                                                  effect: 'require_approval', reason: 'the ACS checker raised a blocking objection' },
    { id: 'allow-authorized',        when: 'registered && toolAuthorized && !(external && egressScope != "external-allowed")', effect: 'allow', reason: 'registered Dot, tool granted by task type, within egress scope' },
  ],
});

/** Opinionated starter packs operators can adopt and tune (Finance, Customer data, Engineering). */
export const STARTER_PACKS = Object.freeze({
  finance: {
    version: 'finance-0.3.0',
    rules: [
      { id: 'fin-block-restricted-egress', when: 'external && "restricted" in dataClasses', effect: 'block', reason: 'restricted finance data (payroll / comp) cannot leave the org' },
      { id: 'fin-block-money-external',    when: 'tool == "transfer_funds" && external',     effect: 'block', reason: 'funds may not move to an external recipient without a named grant' },
      { id: 'fin-approve-money',           when: 'tool == "transfer_funds"',                 effect: 'require_approval', reason: 'all fund transfers require human approval' },
      { id: 'fin-allow-internal',          when: 'registered && toolAuthorized && !external', effect: 'allow', reason: 'internal finance task within grants' },
    ],
  },
  customer_data: {
    version: 'customer-0.3.0',
    rules: [
      { id: 'cust-block-pii-egress', when: 'external && ("restricted" in dataClasses || "confidential" in dataClasses)', effect: 'block', reason: 'customer PII cannot be sent outside the org' },
      { id: 'cust-approve-bulk',     when: 'recordCount > 100',                              effect: 'require_approval', reason: 'bulk customer-record access needs approval' },
      { id: 'cust-allow-internal',   when: 'registered && toolAuthorized && !external',      effect: 'allow', reason: 'internal support task within grants' },
    ],
  },
  engineering: {
    version: 'eng-0.3.0',
    rules: [
      { id: 'eng-block-secret-egress', when: 'external && "secret" in dataClasses',          effect: 'block', reason: 'secrets / credentials cannot leave the org' },
      { id: 'eng-approve-crit-admin',  when: 'tool == "admin" && riskBand == "critical"',    effect: 'require_approval', reason: 'critical infra / admin actions need approval' },
      { id: 'eng-allow-authorized',    when: 'registered && toolAuthorized',                 effect: 'allow', reason: 'engineering task within grants' },
    ],
  },
});
