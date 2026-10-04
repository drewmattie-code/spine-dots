// SPINE-dots demo — the same risky action, ungoverned vs governed.
//   node demo/run.mjs            # side-by-side (the pitch)
//   node demo/run.mjs --vanilla  # only the ungoverned OpenDots path
import { handle } from '../src/gateway.js';
import * as agsLog from '../src/layers/ags.js';
import { setupFinanceDot, RISKY_ACTION } from './setup.js';

const C = { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', cyn: '\x1b[36m', bold: '\x1b[1m', r: '\x1b[0m' };
const rule = (s) => console.log(`${C.dim}${'─'.repeat(64)}${C.r}` + (s ? `\n${C.bold}${s}${C.r}` : ''));
const vanillaOnly = process.argv.includes('--vanilla');

function vanilla(action) {
  rule('① VANILLA OpenDots  —  a human gets one approval card');
  console.log(`  Card:  "${action.tool}" wants to read ${action.datasets.join(', ')} and send to ${action.recipient}.`);
  console.log(`         [ Approve ]  [ Deny ]`);
  console.log(`  Human clicks ${C.grn}Approve${C.r} (blind — no risk score, no second opinion).`);
  console.log(`  ${C.red}▶ EXECUTED: payroll.csv (incl. salary, ssn) emailed to ${action.recipient}${C.r}`);
  console.log(`  ${C.red}▶ Restricted compensation data just left the company. Nobody can prove who checked it.${C.r}`);
}

async function governed(action) {
  rule('② SPINE-dots  —  the same action, through the eight layers');
  const d = await handle(action);
  const tag = d.decision === 'BLOCK' ? `${C.red}${d.decision}${C.r}` : d.decision === 'NEEDS_APPROVAL' ? `${C.ylw}${d.decision}${C.r}` : `${C.grn}${d.decision}${C.r}`;
  console.log(`  Decision: ${C.bold}${tag}`);
  console.log(`  Risk (CRI): ${C.ylw}${d.card.risk}${C.r}`);
  for (const f of d.risk.factors) console.log(`     ${C.dim}· ${f.name} (+${f.points})${C.r}`);
  if (d.data.redacted.length) {
    console.log(`  GDS redacted: ${C.cyn}${d.data.redacted.map((x) => `${x.dataset}.${x.field} [${x.sensitivity}]`).join(', ')}${C.r}`);
  }
  if (d.objections.length) {
    console.log(`  ACS checker objections:`);
    for (const o of d.objections) console.log(`     ${C.red}✗ [${o.severity}]${C.r} ${o.note}`);
  }
  console.log(`  Why:`);
  for (const r of d.reasons) console.log(`     ${C.dim}· ${r}${C.r}`);
  console.log(`  Audit: ${C.dim}${d.card.auditId} (hash-chained, tamper-evident)${C.r}`);
  if (d.decision === 'BLOCK') console.log(`  ${C.grn}▶ The leak never happened. The attempt is on the record.${C.r}`);
  return d;
}

(async () => {
  console.log(`\n${C.bold}${C.cyn}SPINE-dots${C.r} — governance layer for CopilotKit Dots\n`);
  const { promotion } = setupFinanceDot();
  rule('Spine Gate — Finance Dot was promoted sandbox → production');
  for (const c of promotion.result.checks) console.log(`  ${c.ok ? C.grn + '✓' : C.red + '✗'}${C.r} ${c.name.padEnd(20)} ${C.dim}${c.detail}${C.r}`);
  console.log(`  ${C.dim}(note: egress scope = internal-only — the Gate never cleared it to email outsiders)${C.r}\n`);

  vanilla(RISKY_ACTION);
  if (vanillaOnly) { rule(''); return; }
  console.log('');
  await governed(RISKY_ACTION);

  rule('');
  const chain = agsLog.verifyChain();
  console.log(`${C.bold}Same action. One blind click vs. a risk score, a second opinion, scoped data,`);
  console.log(`a blocked leak, and a tamper-evident record.${C.r}`);
  console.log(`${C.dim}AGS audit chain: ${chain.ok ? C.grn + 'intact' : C.red + 'BROKEN'}${C.r}${C.dim} (${chain.length} entries)${C.r}\n`);
})();
