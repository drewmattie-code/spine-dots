// SPINE-dots gateway — the one load-bearing hook.
// Every tool call a Dot wants to make passes through here before it runs. The gateway orchestrates
// the eight Spine layers into a single decision (ALLOW / NEEDS_APPROVAL / BLOCK) plus an enriched
// card for the OpenDots approval UI, and writes a tamper-evident log entry. Wire this into the
// OpenDots tool-dispatch (see adapters/opendots.md); nothing else in your runtime has to change.
import * as ars from './layers/ars.js';
import * as pds from './layers/pds.js';
import * as gds from './layers/gds.js';
import * as cri from './layers/cri.js';
import * as ags from './layers/ags.js';
import * as acs from './layers/acs.js';
import { Decision, Reversibility, ToolClass } from './types.js';
import { classifyRecipient } from './egress.js';

const inferReversibility = (toolClass) =>
  ({ [ToolClass.READ]: Reversibility.REVERSIBLE, [ToolClass.RESEARCH]: Reversibility.REVERSIBLE,
     [ToolClass.WRITE]: Reversibility.PARTIAL, [ToolClass.EGRESS]: Reversibility.IRREVERSIBLE,
     [ToolClass.MONEY]: Reversibility.IRREVERSIBLE, [ToolClass.ADMIN]: Reversibility.IRREVERSIBLE }[toolClass]
     ?? Reversibility.PARTIAL);

/**
 * Govern one action.
 * @param {import('./types.js').Action} action
 * @param {{catalog?, datasets?, acsClient?}} [opts]
 * @returns {Promise<import('./types.js').GatewayDecision>}
 */
export async function handle(action, opts = {}) {
  const reasons = [];
  const dot = ars.lookup(action.dotId);
  const registered = ars.isRunnable(action.dotId);

  // 1. ARS — must be a registered, approved Dot.
  if (!dot || !registered) {
    const logId = ags.log({ action, decision: Decision.BLOCK, reasons: ['unregistered Dot'] }).id;
    return finalize(Decision.BLOCK, ['Dot is not registered/approved in ARS (ARS)'], nullRisk(), [], { granted: [], redacted: [] }, logId, action, dot);
  }

  // 2. PDS — tools come from the registered task TYPE, never the agent's free-text task string.
  const auth = pds.authorizeByTaskType(dot, action.taskType, action.tool, { catalog: opts.catalog, taskTypes: opts.taskTypes });
  const toolClass = auth.tool?.class ?? ToolClass.WRITE;
  if (!auth.ok) reasons.push(`PDS: ${auth.reason}`);

  // 3. GDS — report redactions (card), and MEDIATE the data path: the tool gets only cleared fields.
  const data = gds.access(dot, action.datasets ?? [], opts.datasets);
  const peakSensitivity = gds.peakSensitivity(action.datasets ?? [], opts.datasets);
  if (data.redacted.length) reasons.push(`GDS: redacted ${data.redacted.length} field(s) above clearance`);
  const primaryDataset = (action.datasets ?? [])[0];
  const mediated = (primaryDataset && action.payload)
    ? gds.mediate(dot, primaryDataset, action.payload, opts.datasets)
    : { payload: action.payload ?? {}, redactedFields: [] };
  data.mediatedPayload = mediated.payload; // what the tool is actually handed

  // 4. Egress classification (org allowlist, default external) — only meaningful for egress tools.
  const external = toolClass === ToolClass.EGRESS
    ? classifyRecipient(action.recipient, opts.egressAllowlist ?? {}) === 'external'
    : false;

  // 4b. Egress DLP — scan the outbound body/subject for classified values pasted into free text.
  let dlpHit = false;
  if (toolClass === ToolClass.EGRESS && primaryDataset) {
    const text = [action.args?.subject, action.args?.body].filter(Boolean).join(' ');
    const scan = gds.scanEgress(text, dot, primaryDataset, action.payload ?? {}, opts.datasets);
    dlpHit = !scan.clean;
    if (dlpHit) reasons.push(`GDS/DLP: outbound text contains ${scan.hits.length} classified value(s)`);
  }

  // 5. CRI — explainable risk score.
  const risk = cri.score({ toolClass, sensitivity: peakSensitivity, reversibility: action.reversibility ?? inferReversibility(toolClass), external, blastRadius: action.blastRadius });

  // 6. ACS — adversarial check when the action is high-risk or externally-facing with sensitive data.
  // Rich, typed policy context so declarative policies (incl. the starter packs) can reference the
  // tool, the data classes touched, the amount, and record count — not just the base flags.
  const baseCtx = {
    registered, toolAuthorized: auth.ok, external, egressScope: dot.egressScope,
    peakSensitivity, riskBand: risk.band, dlpHit,
    tool: action.tool,
    dataClasses: gds.dataClasses(action.datasets ?? [], opts.datasets),
    recipientClass: external ? 'external' : 'internal',
    amount: action.args?.amount,
    recordCount: action.recordCount ?? action.args?.recordCount,
  };
  let acsResult = { objections: [], blocking: false, checker: null };
  if (ags.requiresACS(baseCtx)) {
    acsResult = await acs.llmCheck({ action, dot, risk, gds: data, toolClass, external, reversibility: action.reversibility ?? inferReversibility(toolClass) }, opts.acsClient);
    for (const o of acsResult.objections) reasons.push(`ACS[${o.severity}]: ${o.note}`);
  }

  // 6. AGS — policy decision over the whole context, then an immutable log entry.
  const policyResult = ags.evaluate({ ...baseCtx, acsBlocking: acsResult.blocking }, opts.policy);
  let decision = policyResult.decision;
  reasons.push(...policyResult.reasons.map((r) => `AGS: ${r}`));
  // Dry-run (POST /v1/decide?dryRun=true): preview the decision without writing the log or executing.
  let logId = null;
  if (!opts.dryRun) {
    const auditSink = opts.auditSink ?? ags.log;
    try {
      // No acknowledged decision without a durable audit entry — fail closed on write failure.
      logId = auditSink({ action, dotId: dot.id, tier: dot.tier, decision, risk, redactions: data.redacted, acs: acsResult.objections, reasons })?.id ?? null;
    } catch (e) {
      decision = Decision.BLOCK;
      reasons.push(`AGS: audit log write failed (${e.message}) — failing closed to BLOCK`);
    }
  }

  const result = finalize(decision, reasons, risk, acsResult.objections, data, logId, action, dot);
  if (opts.dryRun) result.dryRun = true;
  return result;
}

const nullRisk = () => ({ score: 0, band: 'low', factors: [] });

function finalize(decision, reasons, risk, objections, data, logId, action, dot) {
  return {
    decision, reasons, risk, objections, data, logId,
    card: {
      title: `${dot?.name ?? action.dotId} wants to run ${action.tool}`,
      subtitle: action.task,
      decision,
      risk: `${risk.band.toUpperCase()} (${risk.score}/100)`,
      riskFactors: risk.factors,
      redactions: data.redacted,
      checkerObjections: objections,
      auditId: logId,
    },
  };
}
