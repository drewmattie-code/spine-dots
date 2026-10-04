// The Spine Gate — the one funnel from the practice room (sandbox) to the production floor.
// To move up a tier a Dot must pass a checklist; the riskier the tier, the higher the bar. If it
// fails, the gate names the failing check (ownable ticket), it does NOT just say "denied".
import * as ars from './ars.js';
import * as dcs from './dcs.js';
import { Tier, ToolClass } from '../types.js';

const TIER_RANK = { [Tier.SANDBOX]: 0, [Tier.STAGING]: 1, [Tier.PRODUCTION]: 2 };
// Tool classes that require an explicit, logged grant to reach a given tier.
const HIGH_PRIV = [ToolClass.EGRESS, ToolClass.MONEY, ToolClass.ADMIN];

/** Run conformance checks for promoting dotId to targetTier. Returns {ok, checks:[{name,ok,detail}]}. */
export function check(dotId, targetTier) {
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

  // Least privilege: high-privilege tool classes are only allowed at production, and must be an
  // explicit, named grant (not a leftover sandbox default).
  const highPriv = d.toolClasses.filter((c) => HIGH_PRIV.includes(c));
  if (TIER_RANK[targetTier] >= TIER_RANK[Tier.PRODUCTION]) {
    add('least-privilege', true, highPriv.length ? `high-priv grants (explicit): ${highPriv.join(', ')}` : 'no high-privilege tools');
  } else {
    add('least-privilege', highPriv.length === 0, highPriv.length ? `high-priv tools (${highPriv.join(', ')}) not allowed below production` : 'ok');
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

/** Promote if the Dot passes the gate. Returns {promoted, result}. */
export function promote(dotId, targetTier) {
  const result = check(dotId, targetTier);
  if (!result.ok) return { promoted: false, result };
  ars.register({ ...ars.lookup(dotId), tier: targetTier, approved: true });
  return { promoted: true, result };
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
