// The Spine Gate — the one funnel from the practice room (sandbox) to the production floor.
// To move up a tier a Dot must pass a checklist; the riskier the tier, the higher the bar. If it
// fails, the gate names the failing check (ownable ticket), it does NOT just say "denied".
import * as ars from './ars.js';
import * as dcs from './dcs.js';
import { Tier, ToolClass } from '../types.js';

const TIER_RANK = { [Tier.SANDBOX]: 0, [Tier.STAGING]: 1, [Tier.PRODUCTION]: 2 };
// Tool classes that require an explicit, logged grant to reach a given tier.
const HIGH_PRIV = [ToolClass.EGRESS, ToolClass.MONEY, ToolClass.ADMIN];

// Per-tier conformance bar — the riskier the tier, the higher the required pass rates (C8).
const CONFORMANCE = {
  [Tier.SANDBOX]:    { minEval: 0,    minRedTeam: 0 },
  [Tier.STAGING]:    { minEval: 0.80, minRedTeam: 0.90 },
  [Tier.PRODUCTION]: { minEval: 0.90, minRedTeam: 0.95 },
};

/**
 * Run conformance checks for promoting dotId to targetTier.
 * @param {string} dotId
 * @param {string} targetTier
 * @param {{evalPassRate?:number, redTeamPassRate?:number, grants?:{toolClass,approver,expiry}[]}} [evidence]
 * @returns {{ok, checks:[{name,ok,detail}]}}
 */
export function check(dotId, targetTier, evidence = {}) {
  const d = ars.lookup(dotId);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add('identity', !!d, d ? `registered as "${d.name}", owner ${d.owner}` : 'not in ARS');
  if (!d) return { ok: false, checks };

  add('registry-current', !!d.version, `version ${d.version}`);
  add('owner-known', d.owner && d.owner !== 'unknown', `owner: ${d.owner}`);
  add('clean-memory', dcs.isClean(dotId), dcs.isClean(dotId) ? 'no unexplained open items (DCS)' : 'DCS handover has open items');
  add('data-clearance-set', !!d.clearance, `clearance: ${d.clearance}`);
  add('egress-scope-set', !!d.egressScope, `egress: ${d.egressScope}`);

  // Per-tier eval + red-team pass rates (fail closed when the bar is > 0 and evidence is missing).
  const bar = CONFORMANCE[targetTier] ?? CONFORMANCE[Tier.SANDBOX];
  if (bar.minEval > 0) {
    const ev = evidence.evalPassRate;
    add('eval-pass-rate', typeof ev === 'number' && ev >= bar.minEval,
      typeof ev === 'number' ? `${(ev * 100).toFixed(0)}% (bar ${bar.minEval * 100}%)` : 'no eval results provided');
  }
  if (bar.minRedTeam > 0) {
    const rt = evidence.redTeamPassRate;
    add('red-team-pass-rate', typeof rt === 'number' && rt >= bar.minRedTeam,
      typeof rt === 'number' ? `${(rt * 100).toFixed(0)}% (bar ${bar.minRedTeam * 100}%)` : 'no red-team results provided');
  }

  // Least privilege: below production, high-priv tools aren't allowed at all. At production each
  // high-priv tool class must have a named grant with an approver and a non-expired expiry.
  const highPriv = d.toolClasses.filter((c) => HIGH_PRIV.includes(c));
  if (TIER_RANK[targetTier] >= TIER_RANK[Tier.PRODUCTION]) {
    const grants = evidence.grants ?? [];
    for (const cls of highPriv) {
      const g = grants.find((x) => x.toolClass === cls);
      const inDate = !!(g && g.expiry && new Date(g.expiry).getTime() > Date.now());
      add(`named-grant:${cls}`, !!(g && g.approver && inDate),
        !g ? `no named grant for high-priv "${cls}"`
          : !g.approver ? `grant for "${cls}" has no approver`
          : !inDate ? `grant for "${cls}" is expired (${g.expiry})`
          : `approved by ${g.approver}, expires ${g.expiry}`);
    }
  } else {
    add('least-privilege', highPriv.length === 0, highPriv.length ? `high-priv tools (${highPriv.join(', ')}) not allowed below production` : 'ok');
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

/** Promote if the Dot passes the gate's conformance suite. Returns {promoted, result}. */
export function promote(dotId, targetTier, evidence = {}) {
  const result = check(dotId, targetTier, evidence);
  if (!result.ok) return { promoted: false, result };
  ars.register({ ...ars.lookup(dotId), tier: targetTier, approved: true });
  return { promoted: true, result };
}

/** Auto-demote a Dot to sandbox + unapproved (on revocation, failed recert, or anomaly breach). */
export function demote(dotId, reason = 'unspecified') {
  const d = ars.lookup(dotId);
  if (!d) return { demoted: false, reason: 'not registered in ARS' };
  ars.register({ ...d, tier: Tier.SANDBOX, approved: false });
  return { demoted: true, from: d.tier, reason };
}

// --- CLI ---  node src/layers/gate.js <check|promote> <dotId> <tier>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, dotId, tier = Tier.PRODUCTION] = process.argv.slice(2);
  if (!['check', 'promote'].includes(cmd) || !dotId) {
    console.log('usage: node src/layers/gate.js <check|promote> <dotId> [tier]');
    process.exit(1);
  }
  const out = cmd === 'promote' ? promote(dotId, tier) : { result: check(dotId, tier) };
  for (const c of out.result.checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name.padEnd(20)} ${c.detail}`);
  console.log(`\nGate: ${out.result.ok ? 'PASS' : 'FAIL'}${cmd === 'promote' ? ` — ${out.promoted ? `promoted to ${tier}` : 'not promoted'}` : ''}`);
  process.exit(out.result.ok ? 0 : 2);
}
